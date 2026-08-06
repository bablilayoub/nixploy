import { Command } from "commander";
import { apiGet } from "../client.js";
import { printList } from "../utils/output.js";

export function serverCommand(): Command {
	const server = new Command("server").description("Manage remote servers");

	server
		.command("list")
		.description("List managed servers")
		.option("--json", "Print raw JSON")
		.action(async (options: { json?: boolean }) => {
			const rows = await apiGet("server.all");
			printList(rows, ["serverId", "name", "ipAddress", "port", "serverStatus"], options);
		});

	return server;
}
