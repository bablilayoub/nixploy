#!/usr/bin/env node
/**
 * Golden-path API smoke — the whole product in one process, over the public
 * REST surface only (`x-api-key`), so it exercises exactly what the CLI, the
 * MCP tools and every integration use.
 *
 *   readiness → project → docker application (traefik/whoami) → deploy
 *   → deployment row finished with provenance → domain on *.traefik.me
 *   → HTTP(S) through Traefik → stop → start → Postgres service
 *   → local backup destination → backup run → runs list
 *   → delete project → assert nothing is left on the Swarm
 *
 * Exits non-zero on the first failure and prints the deploy log tail when the
 * deploy is what broke. Every resource it creates hangs off one project, and
 * deleting that project is the last step, so a green run leaves no state.
 *
 *   NIXPLOY_URL=http://127.0.0.1:3000 \
 *   NIXPLOY_API_KEY=np_… \
 *   node tools/golden-path-api.mjs
 *
 * Optional env:
 *   SMOKE_TIMEOUT_MS         per-wait budget, default 300000
 *   SMOKE_DOMAIN_SUFFIX      default "traefik.me" (wildcard DNS → 127.0.0.1)
 *   SMOKE_HOST               explicit host instead of "<app>.<suffix>"
 *   SMOKE_TRAEFIK_ORIGIN     probe this origin with a Host: header instead of
 *                            resolving the domain (e.g. http://127.0.0.1 on a
 *                            runner with no outbound DNS). The scheme of the
 *                            probe still follows the domain's own https flag.
 *   SMOKE_SKIP_DOCKER_CHECK  1 → do not shell out to `docker service ls`
 *   SMOKE_KEEP               1 → skip the delete step (debugging only)
 *   SMOKE_BUILD_REPO         git URL to additionally build FROM SOURCE. Off by
 *                            default because a real build is slow, but this is
 *                            the only step that exercises the builders — the
 *                            v0.2.7 buildx breakage shipped precisely because
 *                            every smoke deployed a prebuilt image.
 *   SMOKE_BUILD_TYPE         dockerfile (default) | nixpacks | railpack |
 *                            static | paketo_buildpacks | heroku_buildpacks
 *   SMOKE_BUILD_BRANCH       default "main"
 *   SMOKE_BUILD_DOCKERFILE   default "Dockerfile" (dockerfile builds only)
 */

import { execFile } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = (process.env.NIXPLOY_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const API_KEY = process.env.NIXPLOY_API_KEY;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 300_000);
const DOMAIN_SUFFIX = process.env.SMOKE_DOMAIN_SUFFIX ?? "traefik.me";
const TRAEFIK_ORIGIN = process.env.SMOKE_TRAEFIK_ORIGIN ?? "";
const SKIP_DOCKER_CHECK = process.env.SMOKE_SKIP_DOCKER_CHECK === "1";
const KEEP = process.env.SMOKE_KEEP === "1";
const BUILD_REPO = process.env.SMOKE_BUILD_REPO ?? "";
const BUILD_TYPE = process.env.SMOKE_BUILD_TYPE ?? "dockerfile";
const BUILD_BRANCH = process.env.SMOKE_BUILD_BRANCH ?? "main";
const BUILD_DOCKERFILE = process.env.SMOKE_BUILD_DOCKERFILE ?? "Dockerfile";

if (!API_KEY) {
	console.error("NIXPLOY_API_KEY is required");
	process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*  Output                                                                    */
/* -------------------------------------------------------------------------- */

let stepNumber = 0;
const started = Date.now();

function step(title) {
	stepNumber += 1;
	console.log(`\n── ${stepNumber}. ${title}`);
}

function ok(message) {
	console.log(`   ✓ ${message}`);
}

function info(message) {
	console.log(`   · ${message}`);
}

function fail(message) {
	throw new Error(message);
}

function elapsed() {
	return `${((Date.now() - started) / 1000).toFixed(1)}s`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll `probe` until it returns something other than `null`/`undefined`. The
 * probe is handed a `note(text)` callback for "what I saw this round"; the
 * last note is printed in the timeout message, so a failure says what it was
 * still waiting on instead of just naming the step.
 */
async function waitFor(label, probe, { timeoutMs = TIMEOUT_MS, intervalMs = 3000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	const note = (text) => {
		last = text;
	};
	while (Date.now() < deadline) {
		const result = await probe(note);
		if (result !== null && result !== undefined && result !== false) return result;
		await sleep(intervalMs);
	}
	fail(`Timed out after ${timeoutMs} ms waiting for ${label}${last ? ` (last: ${last})` : ""}`);
}

/* -------------------------------------------------------------------------- */
/*  REST client                                                               */
/* -------------------------------------------------------------------------- */

/** tRPC-over-REST wraps successful payloads in `{ result: { data } }`. */
function unwrap(data) {
	if (
		data &&
		typeof data === "object" &&
		"result" in data &&
		data.result &&
		typeof data.result === "object" &&
		"data" in data.result
	) {
		return data.result.data;
	}
	return data;
}

async function request(method, path, { body, input } = {}) {
	const url = new URL(`${BASE}/api/${path}`);
	if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
	const res = await fetch(url, {
		method,
		headers: {
			"x-api-key": API_KEY,
			...(body !== undefined ? { "content-type": "application/json" } : {}),
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		fail(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
	}
	return unwrap(data);
}

const post = (path, body) => request("POST", path, { body });
const get = (path, input) => request("GET", path, { input });

/* -------------------------------------------------------------------------- */
/*  HTTP probe through Traefik                                                */
/* -------------------------------------------------------------------------- */

/**
 * One request to Traefik. Goes through `node:http(s)` rather than `fetch` for
 * three reasons the smoke needs: an explicit `Host` header (so CI can hit
 * 127.0.0.1 without any DNS), SNI that matches that host, and
 * `rejectUnauthorized: false` behind `SMOKE_INSECURE_TLS=1` — a
 * `certificateType: "none"` domain is served with Traefik's self-signed
 * default certificate on purpose.
 */
function probeThroughTraefik({ host, https: useHttps, path = "/" }) {
	const origin = TRAEFIK_ORIGIN || `${useHttps ? "https" : "http"}://${host}`;
	const parsed = new URL(origin);
	const secure = useHttps;
	const transport = secure ? https : http;
	const port = Number(parsed.port) || (secure ? 443 : 80);
	return new Promise((resolve) => {
		const req = transport.request(
			{
				host: parsed.hostname,
				port,
				path,
				method: "GET",
				headers: { host },
				servername: secure ? host : undefined,
				// A `certificateType: "none"` domain is served with Traefik's
				// self-signed default certificate, so CI opts in explicitly; a
				// smoke against a real panel keeps validation on.
				rejectUnauthorized: process.env.SMOKE_INSECURE_TLS !== "1",
				timeout: 10_000,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					if (body.length < 4096) body += chunk;
				});
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			},
		);
		req.on("timeout", () => {
			req.destroy();
			resolve({ status: 0, body: "", error: "timeout" });
		});
		req.on("error", (error) => resolve({ status: 0, body: "", error: error.message }));
		req.end();
	});
}

/** whoami echoes its request; the body always carries a `Hostname:` line. */
const isWhoamiBody = (body) => /(^|\n)Hostname:/i.test(body);

/* -------------------------------------------------------------------------- */
/*  Deployment helpers                                                        */
/* -------------------------------------------------------------------------- */

const TERMINAL = new Set(["done", "error", "cancelled"]);

async function findDeployment(applicationId, deploymentId) {
	const page = await get("deployment.byApplication", { applicationId, limit: 20 });
	const rows = Array.isArray(page) ? page : (page?.deployments ?? []);
	return rows.find((row) => row.deploymentId === deploymentId) ?? null;
}

async function printDeployLogTail(deploymentId) {
	try {
		const logs = await get("deployment.getLogs", { deploymentId });
		const text = typeof logs === "string" ? logs : (logs?.log ?? "");
		const tail = text.split("\n").slice(-40).join("\n");
		console.error(`\n--- deploy log tail (${deploymentId}) ---\n${tail}\n--- end ---\n`);
	} catch (error) {
		console.error(`   (could not read deploy log: ${error.message})`);
	}
}

/** Queue → run → terminal status, with the log tail on failure. */
async function awaitDeployment(applicationId, deploymentId, label) {
	const row = await waitFor(
		label,
		async (note) => {
			const current = await findDeployment(applicationId, deploymentId);
			if (!current) {
				note("no deployment row yet");
				return null;
			}
			if (!TERMINAL.has(current.status)) {
				note(`status=${current.status}`);
				return null;
			}
			return current;
		},
		{ intervalMs: 2500 },
	);
	if (row.status !== "done") {
		await printDeployLogTail(deploymentId);
		fail(`${label}: deployment finished as "${row.status}" (${row.errorMessage ?? "no message"})`);
	}
	return row;
}

/* -------------------------------------------------------------------------- */
/*  Swarm                                                                     */
/* -------------------------------------------------------------------------- */

/** `Map<serviceName, "1/1">` straight from the daemon this panel drives. */
async function swarmServices() {
	const { stdout } = await execFileAsync(
		"docker",
		["service", "ls", "--format", "{{.Name}}\t{{.Replicas}}"],
		{ timeout: 30_000 },
	);
	const services = new Map();
	for (const line of stdout.split("\n")) {
		const [name, replicas] = line.split("\t");
		if (name?.trim()) services.set(name.trim(), (replicas ?? "").trim());
	}
	return services;
}

async function swarmServiceNames() {
	return [...(await swarmServices()).keys()];
}

/* -------------------------------------------------------------------------- */
/*  Main                                                                      */
/* -------------------------------------------------------------------------- */

/** Set as soon as the project exists so a failure can still tear it down. */
const state = { projectId: null };

async function main() {
	const stamp = Date.now().toString(36);

	step("readiness");
	{
		const res = await fetch(`${BASE}/api/ready`);
		const text = await res.text();
		if (!res.ok) fail(`GET /api/ready → ${res.status}: ${text.slice(0, 600)}`);
		ok(`/api/ready 200 ${text.slice(0, 200)}`);
	}

	step("create project");
	const project = await post("project.create", {
		name: `smoke-${stamp}`,
		description: "golden-path CI",
	});
	state.projectId = project.projectId;
	ok(`project ${state.projectId}`);

	const envs = await get("environment.byProject", { projectId: state.projectId });
	const environmentId = (Array.isArray(envs) ? envs : envs?.environments)?.[0]?.environmentId;
	if (!environmentId) fail("project has no default environment");
	ok(`environment ${environmentId}`);

	step("create docker application (traefik/whoami)");
	const application = await post("application.create", {
		name: `whoami-${stamp}`,
		projectId: state.projectId,
		environmentId,
	});
	const applicationId = application.applicationId;
	const appName = application.appName;
	ok(`application ${applicationId} (${appName})`);

	await post("application.saveSource", {
		applicationId,
		sourceType: "docker",
		dockerImage: "traefik/whoami:v1.10.1",
	});
	ok("source set to traefik/whoami:v1.10.1");

	step("attach a domain");
	const host = process.env.SMOKE_HOST ?? `whoami-${stamp}.${DOMAIN_SUFFIX}`;
	const domain = await post("domain.create", {
		applicationId,
		host,
		https: true,
		certificateType: "none",
		port: 80,
	});
	ok(`domain ${host} (https, default certificate) → ${domain.domainId}`);

	step("deploy");
	const deploy = await post("application.deploy", { applicationId });
	info(`deployment ${deploy.deploymentId}`);
	const finished = await awaitDeployment(applicationId, deploy.deploymentId, "deploy to finish");
	ok(`deployment done in ${elapsed()}`);

	step("deployment provenance");
	if (finished.trigger !== "api") {
		fail(`expected trigger "api" for an API-key deploy, got ${JSON.stringify(finished.trigger)}`);
	}
	if (!finished.triggeredBy) fail("deployment row has no triggeredBy");
	if (!finished.appName) fail("deployment row has no appName (queue key)");
	ok(`trigger=${finished.trigger} triggeredBy=${finished.triggeredBy} appName=${finished.appName}`);

	step("route through Traefik");
	const reachable = async (note) => {
		const plain = await probeThroughTraefik({ host, https: false });
		if (plain.status === 200 && isWhoamiBody(plain.body)) return "http 200";
		const secure = await probeThroughTraefik({ host, https: true });
		if (secure.status === 200 && isWhoamiBody(secure.body)) {
			return `https 200 (http ${plain.status || plain.error})`;
		}
		note?.(`http=${plain.status || plain.error} https=${secure.status || secure.error}`);
		return null;
	};
	const how = await waitFor(`${host} to answer through Traefik`, reachable, { intervalMs: 4000 });
	ok(`${host} → ${how}`);

	step("stop the application");
	await post("application.stop", { applicationId });
	await waitFor(
		"the service to disappear from Traefik",
		async () => {
			const plain = await probeThroughTraefik({ host, https: false });
			const secure = await probeThroughTraefik({ host, https: true });
			const down = !(plain.status === 200 && isWhoamiBody(plain.body));
			const secureDown = !(secure.status === 200 && isWhoamiBody(secure.body));
			return down && secureDown ? `http=${plain.status} https=${secure.status}` : null;
		},
		{ timeoutMs: 120_000, intervalMs: 3000 },
	);
	ok("stopped — Traefik no longer serves the app");

	step("start it again");
	await post("application.start", { applicationId });
	const backUp = await waitFor(`${host} to answer again`, reachable, { intervalMs: 4000 });
	ok(`started — ${host} → ${backUp}`);

	if (BUILD_REPO) {
		step(`build from source (${BUILD_TYPE})`);
		const builtApp = await post("application.create", {
			name: `build-${stamp}`,
			projectId: state.projectId,
			environmentId,
		});
		await post("application.saveSource", {
			applicationId: builtApp.applicationId,
			sourceType: "git",
			gitUrl: BUILD_REPO,
			gitBranch: BUILD_BRANCH,
		});
		await post("application.saveBuildType", {
			applicationId: builtApp.applicationId,
			buildType: BUILD_TYPE,
			...(BUILD_TYPE === "dockerfile" ? { dockerfile: BUILD_DOCKERFILE } : {}),
		});
		info(`building ${BUILD_REPO}#${BUILD_BRANCH} with ${BUILD_TYPE}`);
		const build = await post("application.deploy", { applicationId: builtApp.applicationId });
		await awaitDeployment(builtApp.applicationId, build.deploymentId, "the source build to finish");
		ok(`built and deployed from source in ${elapsed()}`);
	}

	step("create a Postgres service");
	const database = await post("postgres.create", {
		name: `smoke-db-${stamp}`,
		environmentId,
		databaseName: "smokedb",
		databaseUser: "smokeuser",
		databasePassword: `Smoke-${stamp}-pw`,
	});
	const postgresId = database.postgresId;
	const dbAppName = database.appName;
	ok(`postgres ${postgresId} (${dbAppName})`);

	await post("postgres.start", { postgresId });
	if (SKIP_DOCKER_CHECK) {
		const row = await get("postgres.one", { postgresId });
		if (row.status !== "running") fail(`postgres.start left status "${row.status}"`);
		ok("postgres row reports running (Swarm not inspected)");
	} else {
		const replicas = await waitFor(
			"the Postgres Swarm service to run a replica",
			async (note) => {
				const services = await swarmServices().catch(() => new Map());
				const state = services.get(dbAppName);
				if (!state) {
					note("service not created yet");
					return null;
				}
				if (!/^([1-9]\d*)\/\1$/.test(state)) {
					note(`replicas ${state}`);
					return null;
				}
				return state;
			},
			{ timeoutMs: 180_000, intervalMs: 3000 },
		);
		ok(`postgres service ${dbAppName} is on the Swarm (${replicas})`);
	}

	step("local backup destination");
	const destination = await post("destination.create", {
		name: `smoke-local-${stamp}`,
		provider: "local",
	});
	ok(`destination ${destination.destinationId} (${destination.provider})`);

	step("configure and run a backup");
	const backup = await post("backup.create", {
		schedule: "0 3 * * *",
		enabled: false,
		prefix: `smoke-${stamp}`,
		database: "smokedb",
		databaseType: "postgres",
		keepLatestCount: 3,
		destinationId: destination.destinationId,
		serviceId: postgresId,
	});
	ok(`backup ${backup.backupId}`);

	// A Swarm replica that is "1/1" has a container, but Postgres inside it may
	// still be initialising its data directory, and the runner resolves the
	// container by `docker ps` at call time. Retrying exactly that precondition
	// is more honest (and works without a docker CLI) than sleeping.
	await waitFor(
		"the Postgres container to accept a dump",
		async (note) => {
			try {
				await post("backup.runManually", { backupId: backup.backupId });
				return "started";
			} catch (error) {
				if (/no running container/i.test(error.message)) {
					note("database container not up yet");
					return null;
				}
				throw error;
			}
		},
		{ timeoutMs: 180_000, intervalMs: 4000 },
	);

	const run = await waitFor(
		"the backup run to finish",
		async (note) => {
			const runs = await get("backup.runs", { backupId: backup.backupId, limit: 5 });
			const rows = Array.isArray(runs) ? runs : (runs?.runs ?? []);
			const latest = rows[0];
			if (!latest) {
				note("no backup_run row yet");
				return null;
			}
			if (latest.status === "running") {
				note("status=running");
				return null;
			}
			return latest;
		},
		{ timeoutMs: 240_000, intervalMs: 4000 },
	);
	if (run.status !== "success") {
		fail(`backup run finished as "${run.status}": ${run.message ?? run.error ?? "no message"}`);
	}
	ok(`backup run ${run.status} → ${run.objectKey ?? run.fileName ?? "(no key reported)"}`);

	step("runs list");
	const runs = await get("backup.runs", { backupId: backup.backupId, limit: 10 });
	const runRows = Array.isArray(runs) ? runs : (runs?.runs ?? []);
	if (runRows.length < 1) fail("backup.runs returned no rows after a successful run");
	ok(`backup.runs → ${runRows.length} row(s), newest ${runRows[0].status}`);

	if (KEEP) {
		console.log(`\nSMOKE_KEEP=1 — leaving project ${state.projectId} in place.`);
		console.log(`GOLDEN PATH OK (${elapsed()})`);
		return;
	}

	step("delete the project");
	await post("project.delete", { projectId: state.projectId });
	state.projectId = null;
	ok("project deleted");

	step("no leftovers");
	if (SKIP_DOCKER_CHECK) {
		info("SMOKE_SKIP_DOCKER_CHECK=1 — not inspecting the Swarm");
	} else {
		await waitFor(
			"the Swarm services to go away",
			async (note) => {
				const names = await swarmServiceNames();
				const stale = names.filter((name) => name === appName || name === dbAppName);
				if (stale.length > 0) {
					note(`still up: ${stale.join(", ")}`);
					return null;
				}
				return "clean";
			},
			{ timeoutMs: 120_000, intervalMs: 3000 },
		);
		ok(`no Swarm service named ${appName} or ${dbAppName}`);
	}

	console.log(`\nGOLDEN PATH OK (${elapsed()}) — ${stepNumber} steps, host ${host}`);
}

main().catch(async (error) => {
	console.error(`\n✖ golden-path failed at step ${stepNumber}: ${error.message}`);
	// Best-effort teardown: a failed run must not leave Swarm services, Traefik
	// YAML and a Postgres volume behind on the host it was pointed at.
	if (state.projectId && !KEEP) {
		try {
			await post("project.delete", { projectId: state.projectId });
			console.error(`   (cleaned up project ${state.projectId})`);
		} catch (cleanupError) {
			console.error(`   (cleanup of project ${state.projectId} failed: ${cleanupError.message})`);
		}
	}
	process.exit(1);
});
