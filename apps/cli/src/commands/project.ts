import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

export function projectCommand(): Command {
	const project = new Command("project").description("Manage projects");

	project
		.command("list")
		.description("List projects")
		.option("--json", "Print raw JSON")
		.action(async (options: { json?: boolean }) => {
			const projects = await apiGet("project.all");
			printList(projects, ["projectId", "name", "createdAt"], options);
		});

	project
		.command("create")
		.description("Create a project")
		.requiredOption("--name <name>", "Project name")
		.option("--description <description>", "Project description")
		.option("--json", "Print raw JSON")
		.action(async (options: { name: string; description?: string; json?: boolean }) => {
			const created = await apiPost("project.create", {
				name: options.name,
				description: options.description ?? "",
			});
			if (options.json) {
				printJson(created);
			} else {
				printJson({ ok: true, project: created });
			}
		});

	return project;
}
