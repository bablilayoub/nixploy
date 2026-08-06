import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson } from "../utils/output.js";

interface GlobalOptions {
	projectId?: string;
	file?: string;
	json?: boolean;
}

async function readStackFile(path: string): Promise<string> {
	return readFile(path, "utf8");
}

function planCommand(): Command {
	return new Command("plan")
		.description("Show planned changes from a nixploy stack file")
		.option("-f, --file <path>", "Path to nixploy.yaml (or JSON stack file)")
		.option("--project-id <id>", "Target project ID (optional if stack metadata matches)")
		.option("--json", "Print raw JSON")
		.action(async (options: GlobalOptions) => {
			if (!options.file) {
				throw new Error("Provide a stack file with -f nixploy.yaml");
			}
			const yaml = await readStackFile(options.file);
			const plan = await apiPost("gitops.plan", {
				yaml,
				projectId: options.projectId,
				dry: true,
			});
			printJson(plan);
			if (!options.json && typeof plan === "object" && plan !== null && "summary" in plan) {
				const summary = (plan as { summary: { create: number; update: number; noop: number } })
					.summary;
				process.stdout.write(
					`\nPlan: ${summary.create} to create, ${summary.update} to update, ${summary.noop} unchanged\n`,
				);
			}
		});
}

function applyLikeCommand(name: string, description: string): Command {
	return new Command(name)
		.description(description)
		.option("-f, --file <path>", "Path to nixploy.yaml (or JSON stack file)")
		.option("--project-id <id>", "Target project ID (optional if stack metadata matches)")
		.option("--json", "Print raw JSON")
		.action(async (options: GlobalOptions) => {
			if (!options.file) {
				throw new Error("Provide a stack file with -f nixploy.yaml");
			}
			const yaml = await readStackFile(options.file);
			const result = await apiPost("gitops.runApply", {
				yaml,
				projectId: options.projectId,
			});
			printJson(result);
			if (!options.json && typeof result === "object" && result !== null && "applied" in result) {
				process.stdout.write(`Applied ${(result as { applied: number }).applied} change(s).\n`);
			}
		});
}

export function gitopsCommand(): Command {
	const gitops = new Command("gitops").description("GitOps stack export/import helpers");

	gitops
		.command("export")
		.description("Export a project environment to nixploy.yaml")
		.requiredOption("--project-id <id>", "Project ID")
		.requiredOption("--env <name>", "Environment name")
		.option("-o, --output <path>", "Write YAML to file instead of stdout")
		.action(async (options: { projectId: string; env: string; output?: string }) => {
			const result = await apiGet<{ stack: unknown; yaml?: string }>("gitops.exportStack", {
				projectId: options.projectId,
				environmentName: options.env,
				asYaml: "true",
			});
			const yaml = result.yaml ?? JSON.stringify(result.stack, null, 2);
			if (options.output) {
				const { writeFile } = await import("node:fs/promises");
				await writeFile(options.output, yaml, "utf8");
				process.stdout.write(`Wrote ${options.output}\n`);
				return;
			}
			process.stdout.write(`${yaml}\n`);
		});

	return gitops;
}

export function registerGitopsTopLevelCommands(program: Command): void {
	program.addCommand(planCommand());
	program.addCommand(applyLikeCommand("apply", "Apply a nixploy stack file"));
	program.addCommand(applyLikeCommand("sync", "Alias for apply"));
}
