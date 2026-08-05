import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { printJson, printList } from "../utils/output.js";

interface GlobalOptions {
	projectId?: string;
	env?: string;
	json?: boolean;
}

export function appCommand(): Command {
	const app = new Command("app").description("Manage applications");

	app
		.command("list")
		.description("List applications in a project")
		.requiredOption("--project-id <id>", "Project ID")
		.option("--env <name>", "Environment name (defaults to the project's default environment)")
		.option("--json", "Print raw JSON")
		.action(async (options: GlobalOptions) => {
			const apps = await apiGet("application.all", {
				projectId: options.projectId,
				environmentName: options.env,
			});
			printList(apps, ["applicationId", "name", "appName", "status", "buildType"], options);
		});

	app
		.command("create")
		.description("Create an application")
		.requiredOption("--project-id <id>", "Project ID")
		.requiredOption("--name <name>", "Application name")
		.option("--env <name>", "Environment name (defaults to the project's default environment)")
		.option("--description <description>", "Application description")
		.option("--json", "Print raw JSON")
		.action(async (options: GlobalOptions & { name: string; description?: string }) => {
			const created = await apiPost("application.create", {
				name: options.name,
				projectId: options.projectId,
				environmentName: options.env,
				description: options.description ?? "",
			});
			printJson(options.json ? created : { ok: true, application: created });
		});

	app
		.command("deploy")
		.description("Deploy (build + roll out) an application")
		.argument("<applicationId>", "Application ID")
		.option("--json", "Print raw JSON")
		.action(async (applicationId: string, options: { json?: boolean }) => {
			const result = await apiPost("application.deploy", { applicationId });
			printJson(options.json ? result : { ok: true, deployment: result });
		});

	app
		.command("redeploy")
		.description("Re-rollout the last successful build of an application")
		.argument("<applicationId>", "Application ID")
		.option("--json", "Print raw JSON")
		.action(async (applicationId: string, options: { json?: boolean }) => {
			const result = await apiPost("application.redeploy", { applicationId });
			printJson(options.json ? result : { ok: true, deployment: result });
		});

	app
		.command("logs")
		.description("Print recent deployment logs of an application")
		.argument("<applicationId>", "Application ID")
		.action(async (applicationId: string) => {
			const result = await apiGet<{ logPath?: string; log?: string } | string>("application.logs", {
				applicationId,
			});
			if (typeof result === "string") {
				process.stdout.write(result);
			} else if (result.log) {
				process.stdout.write(result.log);
			} else {
				printJson(result);
			}
		});

	return app;
}
