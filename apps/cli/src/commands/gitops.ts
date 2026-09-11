import { writeFile } from "node:fs/promises";
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
		.option("--project-id <id>", "Target project ID (optional if stack metadata matches)");
	return addOutputOptions(command).action(async (options: StackFileOptions) => {
		if (!options.file) {
			throw usageError("Provide a stack file with -f nixploy.yaml");
		}
		const yaml = await readStackFile(options.file);
		const result = await apiPost<{ applied?: number }>("gitops.runApply", {
			yaml,
			projectId: options.projectId,
		});
		printResult(result, `Applied ${result?.applied ?? 0} change(s).`);
	});
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
			.command("sync-url")
			.description("Pull desired state from a stack URL configured on the project")
			.requiredOption("--project-id <id>", "Project ID"),
	).action(async (options: { projectId: string }) => {
		const result = await apiPost("gitops.syncFromUrl", { projectId: options.projectId });
		printResult(result, "Synced from URL.");
	});

	addOutputOptions(
		gitops
			.command("sync-git")
			.description("Pull desired state from the project's configured git remote")
			.requiredOption("--project-id <id>", "Project ID"),
	).action(async (options: { projectId: string }) => {
		const result = await apiPost("gitops.syncFromGit", { projectId: options.projectId });
		printResult(result, "Synced from git.");
	});

	return gitops;
}

export function registerGitopsTopLevelCommands(program: Command): void {
	program.addCommand(planCommand());
	program.addCommand(applyLikeCommand("apply", "Apply a nixploy stack file"));
	program.addCommand(applyLikeCommand("sync", "Alias for apply"));
}
