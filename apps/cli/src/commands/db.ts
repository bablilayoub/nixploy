import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import {
	addOutputOptions,
	outputMode,
	printJson,
	printList,
	printRaw,
	printRecord,
	printResult,
} from "../utils/output.js";
import { addServiceEnvCommands } from "./service-env.js";

/**
 * Databases live in five per-engine routers that share one generated shape
 * (`modules/databases/router.ts`). The CLI folds them into a single `db` group
 * with the engine as the first positional, so scripts do not have to know
 * which router owns which id.
 */

export const DB_ENGINES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
export type DbEngine = (typeof DB_ENGINES)[number];

export function assertEngine(value: string): DbEngine {
	if (!(DB_ENGINES as readonly string[]).includes(value)) {
		throw usageError(`Unknown database engine "${value}". Expected: ${DB_ENGINES.join(", ")}`);
	}
	return value as DbEngine;
}

const idField = (engine: DbEngine): string => `${engine}Id`;

/** Engine-specific required credentials for `db create`. */
export function createInputFor(
	engine: DbEngine,
	options: {
		name: string;
		environmentId: string;
		databaseName?: string;
		databaseUser?: string;
		databasePassword?: string;
		databaseRootPassword?: string;
		image?: string;
		externalPort?: number;
		description?: string;
		serverId?: string;
	},
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		name: options.name,
		environmentId: options.environmentId,
		...(options.description ? { description: options.description } : {}),
		...(options.image ? { dockerImage: options.image } : {}),
		...(options.externalPort !== undefined ? { externalPort: options.externalPort } : {}),
		...(options.serverId ? { serverId: options.serverId } : {}),
	};
	const password = options.databasePassword;
	if (!password) {
		throw usageError("--password is required");
	}
	if (engine === "redis") {
		return { ...base, databasePassword: password };
	}
	const user = options.databaseUser;
	if (!user) {
		throw usageError(`--user is required for ${engine}`);
	}
	if (engine === "mongo") {
		return { ...base, databaseUser: user, databasePassword: password };
	}
	const database = options.databaseName;
	if (!database) {
		throw usageError(`--database is required for ${engine}`);
	}
	if (engine === "mysql" || engine === "mariadb") {
		const rootPassword = options.databaseRootPassword ?? password;
		return {
			...base,
			databaseName: database,
			databaseUser: user,
			databasePassword: password,
			databaseRootPassword: rootPassword,
		};
	}
	return {
		...base,
		databaseName: database,
		databaseUser: user,
		databasePassword: password,
	};
}

/** Resolve an environment id from a project + optional environment name. */
export async function resolveEnvironmentId(projectId: string, envName?: string): Promise<string> {
	const environments = await apiGet<Array<{ environmentId: string; name: string }>>(
		"environment.byProject",
		{ projectId },
	);
	if (environments.length === 0) {
		throw usageError("Project has no environments");
	}
	if (envName) {
		const match = environments.find((row) => row.name === envName);
		if (!match) {
			throw usageError(`Environment "${envName}" not found in this project`);
		}
		return match.environmentId;
	}
	const first = environments[0];
	if (!first) {
		throw usageError("Project has no environments");
	}
	return first.environmentId;
}

const ENGINE_ARG = "<engine>";
const ENGINE_DESC = `Database engine: ${DB_ENGINES.join(" | ")}`;

export function dbCommand(): Command {
	const db = new Command("db").description(
		"Manage databases (postgres, mysql, mariadb, mongo, redis)",
	);

	addOutputOptions(
		db
			.command("list")
			.description("List databases of a project across every engine")
			.requiredOption("--project-id <id>", "Project ID")
			.option("--env <name>", "Environment name")
			.option("--type <engine>", `Only this engine (${DB_ENGINES.join(", ")})`),
	).action(async (options: { projectId: string; env?: string; type?: string }) => {
		const engines = options.type ? [assertEngine(options.type)] : [...DB_ENGINES];
		const rows: Array<Record<string, unknown>> = [];
		for (const engine of engines) {
			const services = await apiGet<Record<string, unknown>[]>(`${engine}.all`, {
				projectId: options.projectId,
				environmentName: options.env,
			});
			for (const service of services) {
				rows.push({
					id: service[idField(engine)] ?? "",
					type: engine,
					name: service.name ?? "",
					appName: service.appName ?? "",
					status: service.status ?? "",
				});
			}
		}
		printList(rows, ["id", "type", "name", "appName", "status"]);
	});

	addOutputOptions(
		db
			.command("get")
			.description("Show one database service")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.argument("<id>", "Database service ID"),
	).action(async (engine: string, id: string) => {
		const kind = assertEngine(engine);
		const row = await apiGet<Record<string, unknown>>(`${kind}.one`, { [idField(kind)]: id });
		printRecord(row, [
			idField(kind),
			"name",
			"appName",
			"status",
			"dockerImage",
			"databaseName",
			"externalPort",
		]);
	});

	addOutputOptions(
		db
			.command("create")
			.description("Create a database service")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--name <name>", "Service name")
			.option("--env <name>", "Environment name (defaults to the first environment)")
			.option("--database <name>", "Logical database name (postgres, mysql, mariadb)")
			.option("--user <user>", "Database user (all engines except redis)")
			.option("--password <password>", "Database password (visible in `ps` — prefer the panel UI)")
			.option(
				"--root-password <password>",
				"Root password (mysql, mariadb; defaults to --password)",
			)
			.option("--image <image>", "Docker image override, e.g. postgres:17")
			.option("--external-port <port>", "Publish the database on this host port")
			.option("--description <text>", "Description")
			.option("--server-id <id>", "Pin to a managed server"),
	).action(
		async (
			engine: string,
			options: {
				projectId: string;
				name: string;
				env?: string;
				database?: string;
				user?: string;
				password?: string;
				rootPassword?: string;
				image?: string;
				externalPort?: string;
				description?: string;
				serverId?: string;
			},
		) => {
			const kind = assertEngine(engine);
			const environmentId = await resolveEnvironmentId(options.projectId, options.env);
			const externalPort = options.externalPort ? Number(options.externalPort) : undefined;
			if (externalPort !== undefined && !Number.isInteger(externalPort)) {
				throw usageError("--external-port expects an integer");
			}
			const created = await apiPost<Record<string, unknown>>(
				`${kind}.create`,
				createInputFor(kind, {
					name: options.name,
					environmentId,
					databaseName: options.database,
					databaseUser: options.user,
					databasePassword: options.password,
					databaseRootPassword: options.rootPassword,
					image: options.image,
					externalPort,
					description: options.description,
					serverId: options.serverId,
				}),
			);
			printResult(created, `${kind} service created (${String(created[idField(kind)])}).`);
		},
	);

	const lifecycle = [
		["start", "start", "Start the database container"],
		["stop", "stop", "Stop the database container"],
		["restart", "reload", "Recreate the container with the current settings"],
	] as const;
	for (const [verb, procedure, summary] of lifecycle) {
		addOutputOptions(
			db
				.command(verb)
				.description(summary)
				.argument(ENGINE_ARG, ENGINE_DESC)
				.argument("<id>", "Database service ID"),
		).action(async (engine: string, id: string) => {
			const kind = assertEngine(engine);
			const result = await apiPost(`${kind}.${procedure}`, { [idField(kind)]: id });
			printResult(result, `Database ${verb === "restart" ? "restarted" : `${verb}ed`}.`);
		});
	}

	addOutputOptions(
		db
			.command("delete")
			.description("Delete a database service, its container and its volume")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.argument("<id>", "Database service ID")
			.option("-y, --yes", "Confirm the destructive action (required)"),
	).action(async (engine: string, id: string, options: { yes?: boolean }) => {
		if (!options.yes) {
			throw usageError("`db delete` is destructive — re-run with --yes to confirm.");
		}
		const kind = assertEngine(engine);
		const result = await apiPost(`${kind}.remove`, { [idField(kind)]: id });
		printResult(result, "Database deleted.");
	});

	addOutputOptions(
		db
			.command("connection-url")
			.description("Print the connection URL (needs the secrets.read capability)")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.argument("<id>", "Database service ID")
			.option("--external", "Print the host-published URL instead of the in-cluster one"),
	).action(async (engine: string, id: string, options: { external?: boolean }) => {
		const kind = assertEngine(engine);
		const urls = await apiGet<{ internal: string; external: string | null }>(
			`${kind}.getConnectionUrl`,
			{ [idField(kind)]: id },
		);
		if (outputMode().json) {
			printJson(urls);
			return;
		}
		if (options.external) {
			if (!urls.external) {
				throw usageError(
					"This database has no external port. Publish one with `db external-port` first.",
				);
			}
			printRaw(urls.external);
			return;
		}
		printRaw(urls.internal);
	});

	addOutputOptions(
		db
			.command("status")
			.description("Container status of a database service")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.argument("<id>", "Database service ID"),
	).action(async (engine: string, id: string) => {
		const kind = assertEngine(engine);
		const status = await apiGet(`${kind}.getStatus`, { [idField(kind)]: id });
		if (typeof status === "object" && status !== null) {
			printRecord(status);
			return;
		}
		printRaw(String(status));
	});

	addOutputOptions(
		db
			.command("external-port")
			.description("Publish (or unpublish with 0) the database on a host port")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.argument("<id>", "Database service ID")
			.requiredOption("--port <port>", "Host port, or 0 to unpublish"),
	).action(async (engine: string, id: string, options: { port: string }) => {
		const kind = assertEngine(engine);
		const port = Number(options.port);
		if (!Number.isInteger(port) || port < 0 || port > 65535) {
			throw usageError("--port expects an integer between 0 and 65535");
		}
		const result = await apiPost(`${kind}.saveExternalPort`, {
			[idField(kind)]: id,
			externalPort: port === 0 ? null : port,
		});
		printResult(result, port === 0 ? "External port removed." : `Published on port ${port}.`);
	});

	addOutputOptions(
		db
			.command("backups")
			.description("List backup schedules attached to a database service")
			.argument(ENGINE_ARG, ENGINE_DESC)
			.argument("<id>", "Database service ID"),
	).action(async (engine: string, id: string) => {
		const kind = assertEngine(engine);
		const rows = await apiGet("backup.all", { serviceId: id, databaseType: kind });
		printList(rows, ["backupId", "database", "schedule", "enabled", "prefix", "destinationId"]);
	});

	// `db env get postgres-id --type postgres` — the engine comes from --type.
	addServiceEnvCommands(db, "postgres", "<id>", "Database service ID").commands.forEach(
		(command) => {
			command.option("--type <engine>", `Database engine (${DB_ENGINES.join(", ")})`, "postgres");
		},
	);

	return db;
}
