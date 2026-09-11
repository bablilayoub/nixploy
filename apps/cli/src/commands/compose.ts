import { readFile, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { readFileOrStdin } from "../utils/io.js";
import { addOutputOptions, printRaw, printResult } from "../utils/output.js";
import { resolveEnvironmentId } from "./db.js";
import { followDeploymentLogs } from "./deployment.js";
import { addServiceEnvCommands } from "./service-env.js";

/** Compose verbs the registry cannot express: creation (needs an environment
 * lookup), the compose file itself, log following and env editing. */
export function augmentComposeCommand(compose: Command): Command {
	addOutputOptions(
		compose
			.command("create")
			.description("Create a compose service")
			.requiredOption("--project-id <id>", "Project ID")
			.requiredOption("--name <name>", "Compose service name")
			.option("--env <name>", "Environment name (defaults to the first environment)")
			.option("--description <text>", "Description")
			.option("--type <type>", "docker-compose | stack", "docker-compose")
			.option("--source <source>", "raw | git | github | gitlab | bitbucket | gitea", "raw")
			.option("--server-id <id>", "Pin to a managed server"),
	).action(
		async (options: {
			projectId: string;
			name: string;
			env?: string;
			description?: string;
			type: string;
			source: string;
			serverId?: string;
		}) => {
			const environmentId = await resolveEnvironmentId(options.projectId, options.env);
			const created = await apiPost<{ composeId: string }>("compose.create", {
				name: options.name,
				description: options.description ?? null,
				environmentId,
				composeType: options.type,
				sourceType: options.source,
				...(options.serverId ? { serverId: options.serverId } : {}),
			});
			printResult(created, `Compose service created (${created.composeId}).`);
		},
	);

	compose
		.command("logs")
		.description("Print (and optionally follow) the deploy log of a compose service")
		.argument("<composeId>", "Compose ID")
		.option("-f, --follow", "Follow until the latest deployment finishes")
		.action(async (composeId: string, options: { follow?: boolean }) => {
			await followDeploymentLogs({ composeId, follow: Boolean(options.follow) });
		});

	const file = compose.command("file").description("Read or replace the compose file");

	addOutputOptions(
		file
			.command("get")
			.description("Print the compose file of a service")
			.argument("<composeId>", "Compose ID")
			.option("-o, --output <path>", "Write to this file instead of stdout"),
	).action(async (composeId: string, options: { output?: string }) => {
		const row = await apiGet<{ composeFile?: string | null }>("compose.one", { composeId });
		const content = row.composeFile ?? "";
		if (options.output) {
			await writeFile(options.output, content.endsWith("\n") ? content : `${content}\n`, "utf8");
			printResult({ ok: true, path: options.output }, `Wrote ${options.output}`);
			return;
		}
		printRaw(content);
	});

	addOutputOptions(
		file
			.command("set")
			.description("Replace the compose file of a service (validated server-side)")
			.argument("<composeId>", "Compose ID")
			.requiredOption("-f, --file <path>", "Local compose YAML ('-' reads stdin)"),
	).action(async (composeId: string, options: { file: string }) => {
		const composeFile = await readFileOrStdin(options.file);
		const result = await apiPost("compose.saveComposeFile", { composeId, composeFile });
		printResult(result, "Compose file saved.");
	});

	// CLI 0.1 spellings, kept so existing scripts do not break.
	compose
		.command("pull", { hidden: true })
		.description("Deprecated: use `compose file get`")
		.argument("<composeId>", "Compose ID")
		.action(async (composeId: string) => {
			const row = await apiGet<{ composeFile?: string | null }>("compose.one", { composeId });
			printRaw(row.composeFile ?? "");
		});

	compose
		.command("save", { hidden: true })
		.description("Deprecated: use `compose file set`")
		.argument("<composeId>", "Compose ID")
		.requiredOption("--file <path>", "Path to a local compose YAML file")
		.action(async (composeId: string, options: { file: string }) => {
			const composeFile = await readFile(options.file, "utf8");
			const result = await apiPost("compose.saveComposeFile", { composeId, composeFile });
			printResult(result, "Compose file saved.");
		});

	addServiceEnvCommands(compose, "compose", "<composeId>", "Compose ID");

	return compose;
}
