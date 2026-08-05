import { Command } from "commander";
import { apiGet } from "../client.js";
import { printList } from "../utils/output.js";

const DB_TYPES = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;

interface DatabaseRow {
	type: string;
	id: string;
	name: string;
	appName: string;
	status: string;
}

/** Aggregates every database router into one flat list. */
export function dbCommand(): Command {
	const db = new Command("db").description("Manage databases");

	db.command("list")
		.description("List databases (postgres, mysql, mariadb, mongo, redis) in a project")
		.requiredOption("--project-id <id>", "Project ID")
		.option("--env <name>", "Environment name (defaults to the project's default environment)")
		.option("--json", "Print raw JSON")
		.action(async (options: { projectId: string; env?: string; json?: boolean }) => {
			const rows: DatabaseRow[] = [];
			for (const type of DB_TYPES) {
				const services = (await apiGet(`${type}.all`, {
					projectId: options.projectId,
					environmentName: options.env,
				})) as Record<string, unknown>[];
				const idKey = `${type}Id`;
				for (const service of services) {
					rows.push({
						type,
						id: String(service[idKey] ?? ""),
						name: String(service.name ?? ""),
						appName: String(service.appName ?? ""),
						status: String(service.status ?? ""),
					});
				}
			}
			printList(rows, ["type", "id", "name", "appName", "status"], options);
		});

	return db;
}
