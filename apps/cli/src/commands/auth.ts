import { Command } from "commander";
import { apiGet } from "../client.js";
import { configPath, saveConfig } from "../config.js";
import { printJson } from "../utils/output.js";

export function authCommand(): Command {
	const auth = new Command("auth").description("Authenticate with a Nixploy server");

	auth
		.command("login")
		.description("Store an API key for a Nixploy server")
		.requiredOption(
			"--url <url>",
			"Base URL of the Nixploy server (e.g. https://nixploy.example.com)",
		)
		.requiredOption("--api-key <key>", "API key generated in Settings → Profile")
		.action(async (options: { url: string; apiKey: string }) => {
			const apiUrl = options.url.replace(/\/+$/, "");
			// Verify the key before persisting it.
			await apiGet("project.all", undefined, { apiUrl, apiKey: options.apiKey });
			saveConfig({ apiUrl, apiKey: options.apiKey });
			printJson({ ok: true, configPath: configPath(), apiUrl });
		});

	auth
		.command("status")
		.description("Check that the stored credentials are valid")
		.action(async () => {
			await apiGet("project.all");
			printJson({ ok: true });
		});

	return auth;
}
