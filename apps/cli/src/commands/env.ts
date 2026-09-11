import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import {
	describeDiff,
	deserializeEnv,
	diffEnv,
	type EnvMap,
	parsePairs,
	serializeEnv,
} from "../utils/env.js";
import { readFileOrStdin } from "../utils/io.js";
import { addOutputOptions, printJson, printRaw, printResult } from "../utils/output.js";

/**
 * Environment variables at every inheritance level:
 * organization → project → environment → service (later wins on key clash).
 * The `--scope` flag picks the level; `env resolved` shows the merged result
 * the deploy engine actually uses.
 */

const SERVICE_ROUTERS = {
	app: "application",
	application: "application",
	compose: "compose",
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	mongo: "mongo",
	redis: "redis",
} as const;

export type ServiceKind = keyof typeof SERVICE_ROUTERS;

export const SERVICE_KINDS = Object.keys(SERVICE_ROUTERS) as ServiceKind[];

export type EnvScope = "org" | "project" | "environment" | "service";

export interface ScopeOptions {
	scope?: EnvScope;
	projectId?: string;
	environmentId?: string;
	serviceId?: string;
	type?: ServiceKind;
}

function routerFor(kind: ServiceKind | undefined): string {
	const router = SERVICE_ROUTERS[kind ?? "app"];
	if (!router) {
		throw usageError(`Unknown --type. Expected one of: ${SERVICE_KINDS.join(", ")}`);
	}
	return router;
}

/**
 * Does the API key's user hold `secrets.read`? Env columns are nullable, so a
 * `null` blob means either "nothing set here" or "hidden from you" — the row
 * alone cannot tell them apart (the "null vs unset" ambiguity in
 * docs/status.md). One extra call resolves it, memoized per process and only
 * made when a null actually shows up.
 */
let secretsReadCache: Promise<boolean> | null = null;

export function callerCanReadSecrets(): Promise<boolean> {
	secretsReadCache ??= apiGet<{ capabilities?: string[] }>("organization.myCapabilities")
		.then((me) => (me.capabilities ?? []).includes("secrets.read"))
		// If the probe itself fails, assume the worst and report redaction.
		.catch(() => false);
	return secretsReadCache;
}

/** Read the raw `.env` blob of one scope. `null` means "redacted for this caller". */
export async function readScopeEnv(options: ScopeOptions): Promise<string | null> {
	switch (options.scope ?? "service") {
		case "org": {
			const row = await apiGet<{ env: string | null }>("organization.environment");
			return row.env;
		}
		case "project": {
			if (!options.projectId) throw usageError("--scope project needs --project-id");
			const row = await apiGet<{ env: string | null }>("project.one", {
				projectId: options.projectId,
			});
			return row.env;
		}
		case "environment": {
			const environment = await findEnvironment(options);
			return environment.env;
		}
		default: {
			if (!options.serviceId) throw usageError("--scope service needs --service-id");
			const router = routerFor(options.type);
			const row = await apiGet<{ env: string | null }>(`${router}.one`, {
				[`${router}Id`]: options.serviceId,
			} as Record<string, string>);
			return row.env;
		}
	}
}

/** Replace the `.env` blob of one scope. */
export async function writeScopeEnv(options: ScopeOptions, env: string): Promise<void> {
	switch (options.scope ?? "service") {
		case "org":
			await apiPost("organization.saveEnvironment", { env });
			return;
		case "project": {
			if (!options.projectId) throw usageError("--scope project needs --project-id");
			await apiPost("project.saveEnvironment", { projectId: options.projectId, env });
			return;
		}
		case "environment": {
			const environment = await findEnvironment(options);
			await apiPost("environment.saveEnvironment", {
				environmentId: environment.environmentId,
				env,
			});
			return;
		}
		default: {
			if (!options.serviceId) throw usageError("--scope service needs --service-id");
			const router = routerFor(options.type);
			await apiPost(`${router}.saveEnvironment`, {
				[`${router}Id`]: options.serviceId,
				env,
			});
		}
	}
}

/** `--environment-id`, or `--project-id` + `--env <name>`. */
async function findEnvironment(
	options: ScopeOptions & { env?: string },
): Promise<{ environmentId: string; env: string | null }> {
	if (options.environmentId && !options.projectId) {
		throw usageError(
			"--scope environment needs --project-id as well (environments are looked up per project)",
		);
	}
	if (!options.projectId) {
		throw usageError("--scope environment needs --project-id (and --environment-id or --env)");
	}
	const rows = await apiGet<Array<{ environmentId: string; name: string; env: string | null }>>(
		"environment.byProject",
		{ projectId: options.projectId },
	);
	const match = options.environmentId
		? rows.find((row) => row.environmentId === options.environmentId)
		: options.env
			? rows.find((row) => row.name === options.env)
			: rows[0];
	if (!match) {
		throw usageError("Environment not found in this project");
	}
	return match;
}

/** Attach the scope selection flags to a command. */
export function addScopeOptions(command: Command): Command {
	return command
		.option("--scope <scope>", "org | project | environment | service", "service")
		.option("--project-id <id>", "Project ID (project and environment scopes)")
		.option("--environment-id <id>", "Environment ID (environment scope)")
		.option("--env <name>", "Environment name (environment scope, with --project-id)")
		.option("--service-id <id>", "Service ID (service scope)")
		.option("--type <type>", `Service kind: ${SERVICE_KINDS.join(" | ")}`, "app");
}

type EnvCommandOptions = ScopeOptions & { env?: string; replace?: boolean; file?: string };

/**
 * Legacy shim: `nixploy env list <serviceId>` / `env set <serviceId> KEY=V`
 * predate `--scope`. A leading positional without `=` is still read as the
 * service id.
 */
function splitLegacyTarget(values: string[]): { serviceId?: string; pairs: string[] } {
	const [first, ...rest] = values;
	if (first !== undefined && !first.includes("=")) {
		return { serviceId: first, pairs: rest };
	}
	return { pairs: values };
}

/**
 * Turn a possibly-null blob into text, or explain the redaction. A null with
 * `secrets.read` in hand simply means the scope has no variables yet.
 */
export async function requireEnv(env: string | null): Promise<string> {
	if (env !== null) return env;
	if (await callerCanReadSecrets()) return "";
	throw usageError(
		'Environment variables are redacted for this API key (missing the "secrets.read" capability).',
	);
}

export function envCommand(): Command {
	const env = new Command("env").description("Manage environment variables at every scope");

	const get = env
		.command("get")
		.alias("list")
		.description("Print the raw .env blob of one scope")
		.argument("[serviceId]", "Service ID (shorthand for --scope service --service-id)");
	addOutputOptions(addScopeOptions(get)).action(
		async (serviceId: string | undefined, options: EnvCommandOptions) => {
			const scope = { ...options, serviceId: serviceId ?? options.serviceId };
			printRaw(await requireEnv(await readScopeEnv(scope)));
		},
	);

	const set = addScopeOptions(
		env
			.command("set")
			.description("Merge KEY=VALUE pairs into a scope (use --replace to overwrite the blob)")
			.argument("<pairs...>", "KEY=VALUE pairs")
			.option("--replace", "Replace every variable instead of merging"),
	);
	addOutputOptions(set).action(async (values: string[], options: EnvCommandOptions) => {
		const legacy = splitLegacyTarget(values);
		const scope = { ...options, serviceId: legacy.serviceId ?? options.serviceId };
		if (legacy.pairs.length === 0) {
			throw usageError("Provide at least one KEY=VALUE pair");
		}
		const incoming = parsePairs(legacy.pairs);
		const before: EnvMap = options.replace
			? {}
			: deserializeEnv(await requireEnv(await readScopeEnv(scope)));
		const after = { ...before, ...incoming };
		await writeScopeEnv(scope, serializeEnv(after));
		const diff = diffEnv(before, after);
		printResult({ ok: true, ...diff }, `Environment updated: ${describeDiff(diff)}`);
	});

	const importCommand = addScopeOptions(
		env
			.command("import")
			.description("Merge a local .env file into a scope")
			.requiredOption("-f, --file <path>", "Path to a .env file ('-' reads stdin)")
			.option("--replace", "Replace every variable instead of merging"),
	);
	addOutputOptions(importCommand).action(async (options: EnvCommandOptions) => {
		const raw = await readFileOrStdin(options.file as string);
		const incoming = deserializeEnv(raw);
		const before: EnvMap = options.replace
			? {}
			: deserializeEnv(await requireEnv(await readScopeEnv(options)));
		const after = { ...before, ...incoming };
		await writeScopeEnv(options, serializeEnv(after));
		const diff = diffEnv(before, after);
		printResult({ ok: true, ...diff }, `Imported ${options.file}: ${describeDiff(diff)}`);
	});

	const exportCommand = addScopeOptions(
		env
			.command("export")
			.description("Write the .env blob of a scope to a file or stdout")
			.option("-o, --output <path>", "Write to this file instead of stdout"),
	);
	addOutputOptions(exportCommand).action(
		async (options: EnvCommandOptions & { output?: string }) => {
			const value = await requireEnv(await readScopeEnv(options));
			if (options.output) {
				await writeFile(options.output, value.endsWith("\n") ? value : `${value}\n`, "utf8");
				printResult({ ok: true, path: options.output }, `Wrote ${options.output}`);
				return;
			}
			printRaw(value);
		},
	);

	addOutputOptions(
		env
			.command("resolved")
			.description("Merged org → project → environment → service view used by deployments")
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--env <name>", "Environment name"),
	).action(async (options: { projectId: string; env: string }) => {
		const resolved = await apiGet("project.getResolvedEnvironment", {
			projectId: options.projectId,
			environmentName: options.env,
		});
		printJson(resolved);
	});

	return env;
}
