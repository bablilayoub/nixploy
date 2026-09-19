import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { readFileOrStdin } from "../utils/io.js";
import {
	addOutputOptions,
	outputMode,
	printJson,
	printMessage,
	printRaw,
	printResult,
} from "../utils/output.js";

interface StackFileOptions {
	projectId?: string;
	file?: string;
}

async function readStackFile(path: string): Promise<string> {
	return await readFileOrStdin(path);
}

/**
 * The passphrase that seals a secrets bundle: `--passphrase-file`, or the
 * `NIXPLOY_SECRETS_PASSPHRASE` variable. Never an argument — argv is visible
 * to every process on the machine.
 */
async function readPassphrase(options: { passphraseFile?: string }): Promise<string> {
	if (options.passphraseFile) {
		return (await readFile(options.passphraseFile, "utf8")).replace(/\r?\n$/, "");
	}
	const fromEnv = process.env.NIXPLOY_SECRETS_PASSPHRASE;
	if (fromEnv) return fromEnv;
	throw usageError(
		"Provide the bundle passphrase with --passphrase-file <path> or NIXPLOY_SECRETS_PASSPHRASE",
	);
}

function planCommand(): Command {
	const plan = new Command("plan")
		.description("Show planned changes from a nixploy stack file")
		.option("-f, --file <path>", "Path to nixploy.yaml ('-' reads stdin)")
		.option("--project-id <id>", "Target project ID (optional if stack metadata matches)");
	return addOutputOptions(plan).action(async (options: StackFileOptions) => {
		if (!options.file) {
			throw usageError("Provide a stack file with -f nixploy.yaml");
		}
		const yaml = await readStackFile(options.file);
		const result = await apiPost<{
			summary?: { create: number; update: number; noop: number };
		}>("gitops.plan", { yaml, projectId: options.projectId, dry: true });
		if (outputMode().json) {
			printJson(result);
			return;
		}
		printJson(result);
		if (result?.summary) {
			printMessage(
				`\nPlan: ${result.summary.create} to create, ${result.summary.update} to update, ${result.summary.noop} unchanged`,
			);
		}
	});
}

function applyLikeCommand(name: string, description: string): Command {
	const command = new Command(name)
		.description(description)
		.option("-f, --file <path>", "Path to nixploy.yaml ('-' reads stdin)")
		.option("--project-id <id>", "Target project ID (optional if stack metadata matches)")
		.option("--no-redeploy", "Write the rows without redeploying the changed services")
		.option(
			"--secrets <path>",
			"Secrets bundle from `gitops export-secrets`, applied after the manifest and before the redeploy",
		)
		.option("--passphrase-file <path>", "File holding the bundle passphrase");
	return addOutputOptions(command).action(
		async (
			options: StackFileOptions & {
				redeploy: boolean;
				secrets?: string;
				passphraseFile?: string;
			},
		) => {
			if (!options.file) {
				throw usageError("Provide a stack file with -f nixploy.yaml");
			}
			const yaml = await readStackFile(options.file);
			const secrets = options.secrets
				? {
						bundle: (await readFile(options.secrets, "utf8")).trim(),
						passphrase: await readPassphrase(options),
					}
				: undefined;
			const result = await apiPost<{
				applied?: number;
				secrets?: { applied: string[]; missing: string[] } | null;
			}>("gitops.runApply", {
				yaml,
				projectId: options.projectId,
				redeploy: options.redeploy,
				secrets,
			});
			const secretsNote = result?.secrets
				? ` Secrets: ${result.secrets.applied.length} entries written${
						result.secrets.missing.length > 0
							? `, ${result.secrets.missing.length} not found here (${result.secrets.missing.join(", ")})`
							: ""
					}.`
				: "";
			printResult(result, `Applied ${result?.applied ?? 0} change(s).${secretsNote}`);
		},
	);
}

export function gitopsCommand(): Command {
	const gitops = new Command("gitops").description("GitOps stack export / plan / apply helpers");

	addOutputOptions(
		gitops
			.command("export")
			.description("Export a project environment to nixploy.yaml")
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--env <name>", "Environment name")
			.option("-o, --output <path>", "Write YAML to file instead of stdout"),
	).action(async (options: { projectId: string; env: string; output?: string }) => {
		const result = await apiGet<{ stack: unknown; yaml?: string }>("gitops.exportStack", {
			projectId: options.projectId,
			environmentName: options.env,
			asYaml: true,
		});
		const yaml = result.yaml ?? JSON.stringify(result.stack, null, 2);
		if (options.output) {
			await writeFile(options.output, yaml, "utf8");
			printResult({ ok: true, path: options.output }, `Wrote ${options.output}`);
			return;
		}
		printRaw(yaml);
	});

	addOutputOptions(
		gitops
			.command("export-secrets")
			.description(
				"Seal the environment's env values with a passphrase (the manifest carries keys only)",
			)
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--env <name>", "Environment name")
			.option(
				"--passphrase-file <path>",
				"File holding the passphrase (or NIXPLOY_SECRETS_PASSPHRASE)",
			)
			.option("-o, --output <path>", "Write the bundle to a file instead of stdout"),
	).action(
		async (options: {
			projectId: string;
			env: string;
			passphraseFile?: string;
			output?: string;
		}) => {
			const passphrase = await readPassphrase(options);
			const result = await apiPost<{ bundle: string; services: number; keys: number }>(
				"gitops.exportSecrets",
				{ projectId: options.projectId, environmentName: options.env, passphrase },
			);
			if (options.output) {
				await writeFile(options.output, `${result.bundle}\n`, { encoding: "utf8", mode: 0o600 });
				printResult(
					{ ok: true, path: options.output, services: result.services, keys: result.keys },
					`Wrote ${options.output} (${result.services} services, ${result.keys} keys)`,
				);
				return;
			}
			if (outputMode().json) {
				printJson(result);
				return;
			}
			printRaw(result.bundle);
		},
	);

	addOutputOptions(
		gitops
			.command("apply-secrets")
			.description(
				"Write a sealed bundle's env values onto an environment, matching services by name",
			)
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--env <name>", "Environment name")
			.requiredOption("-f, --file <path>", "Bundle from `gitops export-secrets` ('-' reads stdin)")
			.option(
				"--passphrase-file <path>",
				"File holding the passphrase (or NIXPLOY_SECRETS_PASSPHRASE)",
			),
	).action(
		async (options: { projectId: string; env: string; file: string; passphraseFile?: string }) => {
			const bundle = (await readFileOrStdin(options.file)).trim();
			const passphrase = await readPassphrase(options);
			const result = await apiPost<{ applied: string[]; missing: string[] }>(
				"gitops.applySecrets",
				{ projectId: options.projectId, environmentName: options.env, bundle, passphrase },
			);
			const missing =
				result.missing.length > 0 ? `; not found here: ${result.missing.join(", ")}` : "";
			printResult(
				result,
				`Wrote ${result.applied.length} entries (${result.applied.join(", ")})${missing}. Deploy to apply them.`,
			);
		},
	);

	addOutputOptions(
		gitops
			.command("sync-url")
			.description("Fetch a nixploy.yaml from an https URL (raw GitHub/GitLab file) and apply it")
			.requiredOption("--url <url>", "https URL of the stack file")
			.option("--project-id <id>", "Target project ID (optional if stack metadata matches)")
			.option("--no-redeploy", "Apply without redeploying the changed services"),
	).action(async (options: { url: string; projectId?: string; redeploy: boolean }) => {
		const result = await apiPost<{ applied?: number }>("gitops.syncFromUrl", {
			url: options.url,
			projectId: options.projectId,
			redeploy: options.redeploy,
		});
		printResult(result, `Synced from URL: ${result?.applied ?? 0} change(s) applied.`);
	});

	addOutputOptions(
		gitops
			.command("sync-git")
			.description("Apply a nixploy.yaml from a file or stdin (the webhook-style body)")
			.option("-f, --file <path>", "Path to nixploy.yaml ('-' reads stdin)")
			.option("--project-id <id>", "Target project ID (optional if stack metadata matches)")
			.option("--no-redeploy", "Apply without redeploying the changed services"),
	).action(async (options: { file?: string; projectId?: string; redeploy: boolean }) => {
		if (!options.file) {
			throw usageError("Provide a stack file with -f nixploy.yaml");
		}
		const yaml = await readStackFile(options.file);
		const result = await apiPost<{ applied?: number }>("gitops.syncFromGit", {
			yaml,
			projectId: options.projectId,
			redeploy: options.redeploy,
		});
		printResult(result, `Synced: ${result?.applied ?? 0} change(s) applied.`);
	});

	return gitops;
}

export function registerGitopsTopLevelCommands(program: Command): void {
	program.addCommand(planCommand());
	program.addCommand(applyLikeCommand("apply", "Apply a nixploy stack file"));
	program.addCommand(applyLikeCommand("sync", "Alias for apply"));
}
