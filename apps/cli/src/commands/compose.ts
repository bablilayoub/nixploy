import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

export function composeCommand(): Command {
	const compose = new Command("compose").description("Manage compose stack services");

	compose
		.command("list")
		.description("List compose services in a project")
		.requiredOption("--project-id <id>", "Project ID")
		.option("--env <name>", "Environment name")
		.option("--json", "Print raw JSON")
		.action(async (options: { projectId: string; env?: string; json?: boolean }) => {
			const rows = await apiGet("compose.all", {
				projectId: options.projectId,
				environmentName: options.env,
			});
			printList(rows, ["composeId", "name", "appName", "status", "composeType"], options);
		});

	compose
		.command("deploy")
		.description("Deploy a compose service")
		.argument("<composeId>", "Compose ID")
		.option("--json", "Print raw JSON")
		.action(async (composeId: string, options: { json?: boolean }) => {
			const result = await apiPost("compose.deploy", { composeId });
			printJson(options.json ? result : { ok: true, deployment: result });
		});

	compose
		.command("one")
		.description("Show one compose service")
		.argument("<composeId>", "Compose ID")
		.option("--json", "Print raw JSON")
		.action(async (composeId: string, options: { json?: boolean }) => {
			const row = await apiGet("compose.one", { composeId });
			if (options.json) {
				printJson(row);
				return;
			}
			printList([row], ["composeId", "name", "appName", "status", "composeType"], options);
		});

	return compose;
}
