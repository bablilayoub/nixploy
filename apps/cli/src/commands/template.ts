import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

export function templateCommand(): Command {
	const template = new Command("template").description("Browse and deploy catalog templates");

	template
		.command("list")
		.description("List templates in the catalog")
		.option("--json", "Print raw JSON")
		.action(async (options: { json?: boolean }) => {
			const rows = await apiGet("template.all");
			printList(rows, ["id", "name", "category"], options);
		});

	template
		.command("deploy")
		.description("Deploy a template into a project environment")
		.argument("<templateId>", "Template ID")
		.requiredOption("--project-id <id>", "Project ID")
		.requiredOption("--env <name>", "Environment name")
		.option("--json", "Print raw JSON")
		.action(
			async (templateId: string, options: { projectId: string; env: string; json?: boolean }) => {
				const result = await apiPost("template.deploy", {
					templateId,
					projectId: options.projectId,
					environmentName: options.env,
				});
				printJson(options.json ? result : { ok: true, result });
			},
		);

	return template;
}
