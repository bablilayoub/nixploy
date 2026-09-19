import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { apiPost, apiUpload } from "../client.js";
import { CliError, EXIT_ERROR, usageError } from "../errors.js";
import { addOutputOptions, outputMode, printJson, printMessage } from "../utils/output.js";

/**
 * `nixploy import` — bring one environment over from another panel through
 * its API. The source API key comes from a file or from
 * NIXPLOY_IMPORT_API_KEY, never from an argument: argv is visible to every
 * process on the machine and lands in shell history.
 */

interface SourceOptions {
	source: string;
	url?: string;
	apiKeyFile?: string;
	dumpFile?: string;
	dumpId?: string;
}

interface ImportOptions extends SourceOptions {
	sourceProject: string;
	sourceEnv?: string;
	projectId?: string;
	env?: string;
	keepAppNames: boolean;
}

interface ImportNote {
	level: "info" | "warn";
	service?: string;
	message: string;
}

interface ImportPlanResponse {
	source: { host: string; project: string; environment: string };
	target: {
		projectId: string | null;
		projectName: string;
		environmentName: string;
		createsProject: boolean;
		createsEnvironment: boolean;
	};
	notes: ImportNote[];
	counts: {
		applications: number;
		compose: number;
		databases: number;
		domains: number;
		skipped: number;
	};
	plan: { summary: { create: number; update: number; delete: number; noop: number } } | null;
	result?: { applied: number; errors: Array<{ kind: string; name: string; message: string }> };
	secrets?: { applied: string[]; missing: string[] };
}

async function readApiKey(options: { apiKeyFile?: string }): Promise<string> {
	if (options.apiKeyFile) {
		return (await readFile(options.apiKeyFile, "utf8")).replace(/\r?\n$/, "");
	}
	const fromEnv = process.env.NIXPLOY_IMPORT_API_KEY;
	if (fromEnv) return fromEnv;
	throw usageError(
		"Provide the source panel's API key with --api-key-file <path> or NIXPLOY_IMPORT_API_KEY",
	);
}

function addSourceOptions(command: Command): Command {
	return command
		.requiredOption("--source <name>", "Source panel kind (dokploy)")
		.option("--url <url>", "Origin of the running source panel, e.g. https://panel.example.com")
		.option("--api-key-file <path>", "File holding the source API key (or NIXPLOY_IMPORT_API_KEY)")
		.option(
			"--dump-file <path>",
			"Offline: a pg_dump of the source panel's database (plain SQL, gzipped or custom format) instead of --url",
		)
		.option("--dump-id <id>", "Offline: a dump already uploaded in the last 24 hours");
}

/**
 * The source half of every import payload: the live panel (url + key) or an
 * uploaded dump. `--dump-file` uploads first and reuses the id for the call;
 * print it, since plan and apply read the source twice.
 */
async function resolveSourcePayload(
	options: SourceOptions,
): Promise<{ source: string; url?: string; apiKey?: string; dumpId?: string }> {
	if (options.dumpFile || options.dumpId) {
		if (options.url) throw usageError("Give --url or --dump-file/--dump-id, not both");
		let dumpId = options.dumpId;
		if (options.dumpFile) {
			const { readFile } = await import("node:fs/promises");
			let body: Buffer;
			try {
				body = await readFile(options.dumpFile);
			} catch {
				throw usageError(`Cannot read ${options.dumpFile}`);
			}
			const uploaded = await apiUpload<{ dumpId: string; bytes: number; expiresAt: string }>(
				"api/import/dump",
				body,
				{ timeoutMs: 30 * 60_000 },
			);
			dumpId = uploaded.dumpId;
			if (!outputMode().json) {
				printMessage(
					`Uploaded ${uploaded.bytes} bytes as dump ${uploaded.dumpId} (kept until ${uploaded.expiresAt}); reuse it with --dump-id`,
				);
			}
		}
		return { source: options.source, dumpId };
	}
	if (!options.url) throw usageError("Provide --url (running panel) or --dump-file (offline dump)");
	return { source: options.source, url: options.url, apiKey: await readApiKey(options) };
}

function addImportOptions(command: Command): Command {
	return addSourceOptions(command)
		.requiredOption("--source-project <id>", "Source project ID (see `import inspect`)")
		.option("--source-env <name>", "Source environment name (its first one by default)")
		.option("--project-id <id>", "Target project ID (created with the source's name when omitted)")
		.option("--env <name>", "Target environment name (the source's by default)")
		.option(
			"--no-keep-app-names",
			"Generate new appNames instead of keeping the source's (needed when a name is taken here)",
		);
}

function printPlan(result: ImportPlanResponse): void {
	printMessage(
		`Source: ${result.source.project} / ${result.source.environment} on ${result.source.host}`,
	);
	printMessage(
		`Target: ${result.target.projectName} / ${result.target.environmentName}${
			result.target.createsProject
				? " (project will be created)"
				: result.target.createsEnvironment
					? " (environment will be created)"
					: ""
		}`,
	);
	const counts = result.counts;
	printMessage(
		`Services: ${counts.applications} applications, ${counts.compose} compose, ${counts.databases} databases, ${counts.domains} domains${
			counts.skipped > 0 ? `, ${counts.skipped} skipped` : ""
		}`,
	);
	if (result.plan) {
		const summary = result.plan.summary;
		printMessage(
			`Plan: ${summary.create} to create, ${summary.update} to update, ${summary.delete} to delete, ${summary.noop} unchanged`,
		);
	} else {
		printMessage("Plan: everything is a create (the target does not exist yet)");
	}
	if (result.notes.length > 0) {
		printMessage("");
		printMessage("Notes:");
		for (const note of result.notes) {
			printMessage(
				`  ${note.level === "warn" ? "!" : "•"} ${note.service ? `${note.service}: ` : ""}${note.message}`,
			);
		}
	}
}

export function importCommand(): Command {
	const importGroup = new Command("import").description(
		"Import an environment from another panel over its API",
	);

	addOutputOptions(
		addSourceOptions(
			importGroup
				.command("inspect")
				.description("List the projects and environments the source API key can see"),
		),
	).action(async (options: SourceOptions) => {
		const sourcePayload = await resolveSourcePayload(options);
		const result = await apiPost<{
			host: string;
			projects: Array<{
				projectId: string;
				name: string;
				environments: Array<{
					name: string;
					applications: number;
					compose: number;
					databases: number;
					unsupported: number;
				}>;
			}>;
		}>("import.inspect", sourcePayload);
		if (outputMode().json) {
			printJson(result);
			return;
		}
		printMessage(`${result.host}: ${result.projects.length} project(s)`);
		for (const project of result.projects) {
			printMessage(`  ${project.projectId}  ${project.name}`);
			for (const environment of project.environments) {
				printMessage(
					`      ${environment.name}: ${environment.applications} applications, ${environment.compose} compose, ${environment.databases} databases${
						environment.unsupported > 0 ? `, ${environment.unsupported} unsupported` : ""
					}`,
				);
			}
		}
	});

	addOutputOptions(
		addImportOptions(
			importGroup
				.command("plan")
				.description("Translate one source environment and show what an import would change"),
		),
	).action(async (options: ImportOptions) => {
		const sourcePayload = await resolveSourcePayload(options);
		const result = await apiPost<ImportPlanResponse>("import.plan", {
			...sourcePayload,
			sourceProjectId: options.sourceProject,
			sourceEnvironmentName: options.sourceEnv,
			projectId: options.projectId,
			environmentName: options.env,
			keepAppNames: options.keepAppNames,
		});
		if (outputMode().json) {
			printJson(result);
			return;
		}
		printPlan(result);
	});

	addOutputOptions(
		addImportOptions(
			importGroup
				.command("apply")
				.description(
					"Import one source environment: create what is missing, write rows and env values, deploy nothing",
				),
		),
	).action(async (options: ImportOptions) => {
		const sourcePayload = await resolveSourcePayload(options);
		const result = await apiPost<ImportPlanResponse>("import.runApply", {
			...sourcePayload,
			sourceProjectId: options.sourceProject,
			sourceEnvironmentName: options.sourceEnv,
			projectId: options.projectId,
			environmentName: options.env,
			keepAppNames: options.keepAppNames,
		});
		if (outputMode().json) {
			printJson(result);
			return;
		}
		printPlan(result);
		const applied = result.result?.applied ?? 0;
		const errors = result.result?.errors ?? [];
		printMessage("");
		printMessage(
			`Applied ${applied} change(s); ${result.secrets?.applied.length ?? 0} env entries written.`,
		);
		for (const error of errors) {
			printMessage(`  ! ${error.kind}/${error.name}: ${error.message}`);
		}
		printMessage("Nothing was deployed. Review the notes, then deploy each service.");
		if (errors.length > 0) {
			throw new CliError(`${errors.length} service(s) could not be imported`, EXIT_ERROR);
		}
	});

	return importGroup;
}
