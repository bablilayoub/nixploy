import { Command } from "commander";
import { apiGet } from "../client.js";
import { printList } from "../utils/output.js";

export function domainCommand(): Command {
	const domain = new Command("domain").description("List Traefik domains");

	domain
		.command("list")
		.description("List domains for an application, compose, or project")
		.option("--application-id <id>", "Application ID")
		.option("--compose-id <id>", "Compose ID")
		.option("--project-id <id>", "Project ID")
		.option("--json", "Print raw JSON")
		.action(
			async (options: {
				applicationId?: string;
				composeId?: string;
				projectId?: string;
				json?: boolean;
			}) => {
				if (!options.applicationId && !options.composeId && !options.projectId) {
					throw new Error("Provide --application-id, --compose-id, or --project-id");
				}
				const rows = await apiGet("domain.all", {
					applicationId: options.applicationId,
					composeId: options.composeId,
					projectId: options.projectId,
				});
				printList(rows, ["domainId", "host", "path", "port", "https", "certificateType"], options);
			},
		);

	return domain;
}
