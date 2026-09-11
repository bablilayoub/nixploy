import { Command } from "commander";
import { applyExitOverride, resolveExitCode } from "./cli-runtime.js";
import { registerCommands } from "./commands/index.js";
import { EXIT_OK } from "./errors.js";
import { setOutputMode } from "./utils/output.js";

declare const __CLI_VERSION__: string;

// `nixploy audit export | head` (or any piped command) closes stdout early and
// Node turns the next write into an unhandled EPIPE with a stack trace. The
// reader got what it asked for — exit quietly.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
	if (error.code === "EPIPE") process.exit(EXIT_OK);
	throw error;
});

const program = new Command();

program
	.name("nixploy")
	.description("Nixploy CLI — projects, apps, databases, domains and env vars from your terminal")
	.version(__CLI_VERSION__)
	.option("--url <url>", "Nixploy panel base URL (overrides the profile and NIXPLOY_API_URL)")
	.option("--api-key <key>", "API key (visible in `ps`; prefer a profile or NIXPLOY_API_KEY)")
	.option("--profile <name>", "Credential profile from ~/.nixploy/config.json")
	.option("--organization-id <id>", "Organization to act in (sent as x-organization-id)")
	.option("--json", "Print the raw API payload as JSON")
	.option("--quiet", "Print only identifiers; suppress confirmations")
	// Global flags are read from the *leaf* command so `nixploy app list --json`
	// and `nixploy --json app list` behave the same.
	.hook("preAction", (_thisCommand, actionCommand) => {
		const options = actionCommand.optsWithGlobals<{
			url?: string;
			apiKey?: string;
			profile?: string;
			organizationId?: string;
			json?: boolean;
			quiet?: boolean;
		}>();
		if (options.url) process.env.NIXPLOY_API_URL = options.url;
		if (options.apiKey) process.env.NIXPLOY_API_KEY = options.apiKey;
		if (options.profile) process.env.NIXPLOY_PROFILE = options.profile;
		if (options.organizationId) process.env.NIXPLOY_ORG_ID = options.organizationId;
		setOutputMode({ json: options.json, quiet: options.quiet });
	});

registerCommands(program);
applyExitOverride(program);

try {
	await program.parseAsync(process.argv);
	process.exitCode = process.exitCode ?? EXIT_OK;
} catch (error) {
	const { code, message } = resolveExitCode(error);
	if (message) {
		process.stderr.write(`${message}\n`);
	}
	process.exitCode = code;
}
