import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { apiPost } from "../client.js";
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
	url: string;
	apiKeyFile?: string;
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
		.requiredOption("--url <url>", "Origin of the source panel, e.g. https://panel.example.com")
		.option("--api-key-file <path>", "File holding the source API key (or NIXPLOY_IMPORT_API_KEY)");
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
		const apiKey = await readApiKey(options);
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
		}>("import.inspect", { source: options.source, url: options.url, apiKey });
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
		const apiKey = await readApiKey(options);
		const result = await apiPost<ImportPlanResponse>("import.plan", {
			source: options.source,
			url: options.url,
			apiKey,
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
		const apiKey = await readApiKey(options);
		const result = await apiPost<ImportPlanResponse>("import.runApply", {
			source: options.source,
			url: options.url,
			apiKey,
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
