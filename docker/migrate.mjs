/**
 * Production migration runner. Lives next to its own node_modules in the
 * image (`/app/migrate-deps`) so it does not fight Next standalone deps.
 *
 * Connection-level failures (Postgres still booting, DNS not yet resolving
 * the service name) are retried for up to NIXPLOY_DB_WAIT_SECONDS (default
 * 60) — the entrypoint already waited with pg_isready, this covers the gap
 * between "accepting connections" and "ready for the migrator". A failing
 * migration itself is never retried. Boundary updates keep roles stopped or
 * paused until recovery; image rollback cannot reverse an applied schema.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const TERMINAL_TASK_STATES = new Set(["complete", "shutdown", "failed", "rejected", "remove"]);
const BOUNDARY = "0048";

async function docker(args) {
	const { stdout } = await execute("docker", args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
	return stdout;
}

/** Inspect the manager's actual task state, including tasks on other nodes. */
export async function assertPlatformDrained(runDocker = docker) {
	const swarm = JSON.parse(await runDocker(["info", "--format", "{{json .Swarm}}"]));
	if (swarm.LocalNodeState !== "active" || swarm.ControlAvailable !== true) {
		throw new Error("The upgrade boundary requires a reachable Swarm manager");
	}
	const names = (await runDocker(["service", "ls", "--format", "{{.Name}}"]))
		.trim()
		.split(/\s+/)
		.filter((name) => name === "nixploy" || name === "nixploy-worker");
	if (!names.includes("nixploy")) throw new Error("Cannot verify the installed panel service");
	const services = JSON.parse(await runDocker(["service", "inspect", ...names]));
	if (services.length !== names.length) throw new Error("Cannot inspect every platform role");
	for (const service of services) {
		if (service.Spec?.Mode?.Replicated?.Replicas !== 0) {
			throw new Error("Stop every panel and worker replica before the upgrade boundary");
		}
	}
	const ids = [
		...new Set(
			(await runDocker(["service", "ps", "--no-trunc", "--format", "{{.ID}}", ...names]))
				.trim()
				.split(/\s+/)
				.filter(Boolean),
		),
	];
	const tasks = ids.length
		? JSON.parse(await runDocker(["inspect", "--type", "task", ...ids]))
		: [];
	if (tasks.length !== ids.length) throw new Error("Cannot inspect every platform task");
	const serviceIds = new Set(services.map((service) => service.ID));
	for (const task of tasks) {
		if (!serviceIds.has(task.ServiceID) || !TERMINAL_TASK_STATES.has(task.Status?.State)) {
			throw new Error("An old platform task is active or its shutdown cannot be verified");
		}
	}
	const nodeIds = [...new Set(tasks.map((task) => task.NodeID).filter(Boolean))];
	if (nodeIds.length) {
		const nodes = JSON.parse(await runDocker(["node", "inspect", ...nodeIds]));
		if (nodes.length !== nodeIds.length) throw new Error("Cannot inspect every platform node");
		for (const node of nodes) {
			if (
				node.Status?.State !== "ready" ||
				(node.ManagerStatus && node.ManagerStatus.Reachability !== "reachable")
			) {
				throw new Error("A platform node is unreachable; old-role shutdown cannot be verified");
			}
		}
	}
	return { services: services.length, tasks: tasks.length };
}

/** Runs before migrate(), so an old GUI cannot mutate a populated legacy DB. */
export async function prepareUpgradeBoundary(client, migrationsFolder, options = {}) {
	const journal = JSON.parse(await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"));
	if (!journal.entries.some((entry) => entry.tag.startsWith(`${BOUNDARY}_`))) return false;
	const [columns] = await client.unsafe(
		"select exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization' and column_name='metadata') as legacy, exists(select 1 from information_schema.columns where table_schema='public' and table_name='organization' and column_name='metadata_v2') as encrypted",
	);
	if (!columns?.legacy) return false; // Fresh install, or this boundary already committed.
	if (columns.encrypted)
		throw new Error("Ambiguous organization schema; reconcile before upgrading");
	if ((options.acknowledgement ?? process.env.NIXPLOY_UPGRADE_DRAINED) !== BOUNDARY) {
		throw new Error(
			"Encrypted organization variables require the current host update.sh: it drains all old roles, saves recovery assets and runs a separate migrator. No migration was started.",
		);
	}
	await assertPlatformDrained(options.runDocker);
	// max:1 below keeps this session setting on the connection migrate() uses.
	await client.unsafe("select set_config('nixploy.upgrade_0048_drained','1',false)");
	return true;
}

async function main() {
	const [{ drizzle }, { migrate }, { default: postgres }] = await Promise.all([
		import("drizzle-orm/postgres-js"),
		import("drizzle-orm/postgres-js/migrator"),
		import("postgres"),
	]);

	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error("DATABASE_URL is required to run migrations");
		process.exit(1);
	}

	const migrationsFolder = process.env.NIXPLOY_MIGRATIONS_DIR ?? "/app/drizzle";
	const maxWaitMs =
		Math.max(0, Number.parseInt(process.env.NIXPLOY_DB_WAIT_SECONDS ?? "60", 10) || 0) * 1000;
	const retryDelayMs = 3000;

	/** Errors that mean "Postgres is not there yet", as opposed to a bad migration. */
	const RETRYABLE_CODES = new Set([
		"ECONNREFUSED",
		"ECONNRESET",
		"ENOTFOUND",
		"EAI_AGAIN",
		"ETIMEDOUT",
		"CONNECT_TIMEOUT",
		"57P03", // cannot_connect_now (database system is starting up)
		"08001", // sqlclient_unable_to_establish_sqlconnection
		"08006", // connection_failure
	]);

	/**
	 * drizzle wraps driver failures in DrizzleQueryError with the postgres-js
	 * error on `cause`, so walk the chain before deciding.
	 */
	function isRetryable(error, depth = 0) {
		if (!error || typeof error !== "object" || depth > 5) return false;
		const code = error.code;
		if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
		const message = String(error.message ?? "");
		if (/starting up|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT/i.test(message)) {
			return true;
		}
		return isRetryable(error.cause, depth + 1);
	}

	/** One line for the retry log: the innermost cause is the useful part. */
	function describe(error) {
		let current = error;
		while (current && typeof current === "object" && current.cause) current = current.cause;
		return String(current?.message ?? current ?? error).split("\n")[0];
	}

	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const startedAt = Date.now();
	let attempt = 0;
	for (;;) {
		attempt += 1;
		const client = postgres(url, { max: 1, connect_timeout: 10 });
		const db = drizzle(client);
		try {
			await prepareUpgradeBoundary(client, migrationsFolder);
			console.log(`Applying migrations from ${migrationsFolder}…`);
			await migrate(db, { migrationsFolder });
			console.log("Migrations applied.");
			await client.end();
			break;
		} catch (error) {
			await client.end({ timeout: 1 }).catch(() => {});
			const elapsed = Date.now() - startedAt;
			if (isRetryable(error) && elapsed + retryDelayMs <= maxWaitMs) {
				console.warn(
					`Postgres not reachable yet (attempt ${attempt}: ${describe(error)}) — retrying in ${retryDelayMs / 1000}s`,
				);
				await sleep(retryDelayMs);
				continue;
			}
			console.error("Migration failed:", error);
			process.exit(1);
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
