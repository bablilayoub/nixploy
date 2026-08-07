import { Command } from "commander";
import { ApiError } from "./client.js";
import { appCommand } from "./commands/app.js";
import { authCommand } from "./commands/auth.js";
import { composeCommand } from "./commands/compose.js";
import { dbCommand } from "./commands/db.js";
import { deployCommand } from "./commands/deploy.js";
import { doctorCommand } from "./commands/doctor.js";
import { domainCommand } from "./commands/domain.js";
import { envCommand } from "./commands/env.js";
import { gitopsCommand, registerGitopsTopLevelCommands } from "./commands/gitops.js";
import { projectCommand } from "./commands/project.js";
import { serverCommand } from "./commands/server.js";
import { tagCommand } from "./commands/tag.js";
import { templateCommand } from "./commands/template.js";

const program = new Command();

program
	.name("nixploy")
	.description("Nixploy CLI — manage projects, apps, databases and env vars")
	.version("0.1.0")
	.option("--url <url>", "Nixploy server base URL (overrides config and NIXPLOY_API_URL)")
	.option("--api-key <key>", "API key (overrides config and NIXPLOY_API_KEY)")
	.hook("preAction", (thisCommand) => {
		const options = thisCommand.opts<{ url?: string; apiKey?: string }>();
		if (options.url) {
			process.env.NIXPLOY_API_URL = options.url;
		}
		if (options.apiKey) {
			process.env.NIXPLOY_API_KEY = options.apiKey;
		}
	});

program.addCommand(authCommand());
program.addCommand(projectCommand());
program.addCommand(appCommand());
program.addCommand(composeCommand());
program.addCommand(templateCommand());
program.addCommand(tagCommand());
program.addCommand(domainCommand());
program.addCommand(serverCommand());
program.addCommand(deployCommand());
program.addCommand(doctorCommand());
program.addCommand(dbCommand());
program.addCommand(envCommand());
program.addCommand(gitopsCommand());
registerGitopsTopLevelCommands(program);

try {
	await program.parseAsync(process.argv);
} catch (error) {
	if (error instanceof ApiError) {
		process.stderr.write(`Error (HTTP ${error.status}): ${error.message}\n`);
	} else if (error instanceof Error) {
		process.stderr.write(`Error: ${error.message}\n`);
	} else {
		process.stderr.write(`Error: ${String(error)}\n`);
	}
	process.exitCode = 1;
}
