import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

async function resolveEnvironmentId(projectId: string, envName?: string): Promise<string> {
	const environments = await apiGet<Array<{ environmentId: string; name: string }>>(
		"environment.byProject",
		{ projectId },
	);
	if (environments.length === 0) {
		throw new Error("Project has no environments");
	}
	if (envName) {
		const match = environments.find((row) => row.name === envName);
		if (!match) {
			throw new Error(`Environment "${envName}" not found`);
		}
		return match.environmentId;
	}
	const first = environments[0];
	if (!first) {
		throw new Error("Project has no environments");
	}
	return first.environmentId;
}

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
		.command("create")
		.description("Create a raw compose service")
		.requiredOption("--project-id <id>", "Project ID")
		.requiredOption("--name <name>", "Compose service name")
		.option("--env <name>", "Environment name (defaults to the first environment)")
		.option("--description <description>", "Description")
		.option("--type <type>", "Compose type (docker-compose|stack)", "docker-compose")
		.option("--json", "Print raw JSON")
		.action(
			async (options: {
				projectId: string;
				name: string;
				env?: string;
				description?: string;
				type: "docker-compose" | "stack";
				json?: boolean;
			}) => {
				const environmentId = await resolveEnvironmentId(options.projectId, options.env);
				const created = await apiPost("compose.create", {
					name: options.name,
					description: options.description ?? "",
					environmentId,
					composeType: options.type,
					sourceType: "raw",
				});
				printJson(options.json ? created : { ok: true, compose: created });
			},
		);

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
		.command("redeploy")
		.description("Redeploy a compose service from the current source")
		.argument("<composeId>", "Compose ID")
		.option("--json", "Print raw JSON")
		.action(async (composeId: string, options: { json?: boolean }) => {
			const result = await apiPost("compose.redeploy", { composeId });
			printJson(options.json ? result : { ok: true, deployment: result });
		});

	compose
		.command("logs")
		.description("Print recent deployment logs of a compose service")
		.argument("<composeId>", "Compose ID")
		.option("-f, --follow", "Follow until the latest deployment finishes")
		.action(async (composeId: string, options: { follow?: boolean }) => {
			let offset = 0;
			for (;;) {
				const chunk = await apiGet<{
					deploymentId: string;
					status: string;
					log: string;
					offset: number;
					done: boolean;
				}>("deployment.getLogs", {
					composeId,
					offset,
				});
				if (chunk.log) process.stdout.write(chunk.log);
				offset = chunk.offset;
				if (!options.follow || chunk.done) return;
				await new Promise((resolve) => setTimeout(resolve, 1500));
			}
		});

	compose
		.command("env")
		.description("Get or set the compose service .env (use nixploy env for KEY=VALUE merges)")
		.argument("<composeId>", "Compose ID")
		.option("--set <content>", "Replace the entire .env content")
		.option("--json", "Print raw JSON")
		.action(async (composeId: string, options: { set?: string; json?: boolean }) => {
			if (options.set !== undefined) {
				const result = await apiPost("compose.saveEnvironment", {
					composeId,
					env: options.set,
				});
				printJson(options.json ? result : { ok: true });
				return;
			}
			const row = await apiGet<{ env?: string }>("compose.one", { composeId });
			process.stdout.write(row.env ?? "");
			if (row.env && !row.env.endsWith("\n")) {
				process.stdout.write("\n");
			}
		});

	compose
		.command("save")
		.description("Save compose file content for a service")
		.argument("<composeId>", "Compose ID")
		.requiredOption("--file <path>", "Path to a local compose YAML file")
		.option("--json", "Print raw JSON")
		.action(async (composeId: string, options: { file: string; json?: boolean }) => {
			const { readFile } = await import("node:fs/promises");
			const composeFile = await readFile(options.file, "utf8");
			const result = await apiPost("compose.saveComposeFile", { composeId, composeFile });
			printJson(options.json ? result : { ok: true });
		});

	compose
		.command("pull")
		.description("Print the compose file content for a service")
		.argument("<composeId>", "Compose ID")
		.action(async (composeId: string) => {
			const row = await apiGet<{ composeFile?: string }>("compose.one", { composeId });
			process.stdout.write(row.composeFile ?? "");
			if (row.composeFile && !row.composeFile.endsWith("\n")) {
				process.stdout.write("\n");
			}
		});

	return compose;
}
