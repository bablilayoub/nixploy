import { Command } from "commander";
import { apiGet } from "../client.js";
import {
	activeProfileName,
	configPath,
	listProfiles,
	readProfile,
	removeProfile,
	writeProfile,
} from "../config.js";
import { CliError, usageError } from "../errors.js";
import {
	addOutputOptions,
	printList,
	printRecord,
	printResult,
	printWarning,
} from "../utils/output.js";
import { readSecret } from "../utils/prompt.js";
import type { MyCapabilities } from "./org.js";

/**
 * Credential management. The API key is read from stdin or a no-echo prompt —
 * never from argv, which is world-readable in `ps` and lands in shell history.
 * `--api-key` stays accepted for the CLI 0.1 flow but warns.
 */
export function authCommand(): Command {
	const auth = new Command("auth").description("Authenticate with a Nixploy server");

	addOutputOptions(
		auth
			.command("login")
			.description("Store an API key for a Nixploy server (key read from stdin or a prompt)")
			.requiredOption("--url <url>", "Base URL of the panel, e.g. https://panel.example.com")
			.option("--profile <name>", "Profile to write (default: the active profile)")
			.option("--organization-id <id>", "Pin a multi-org key to one organization")
			.option("--api-key <key>", "Deprecated: passes the key through argv (visible in `ps`)"),
	).action(
		async (options: {
			url: string;
			profile?: string;
			organizationId?: string;
			apiKey?: string;
		}) => {
			const apiUrl = options.url.replace(/\/+$/, "");
			let apiKey = options.apiKey;
			if (apiKey) {
				printWarning(
					"--api-key puts the key in your shell history and in `ps`. Pipe it on stdin instead: echo $KEY | nixploy auth login --url …",
				);
			} else {
				apiKey = await readSecret("API key: ");
			}
			if (!apiKey) {
				throw usageError("No API key provided (stdin was empty).");
			}

			// Verify before persisting so a typo never becomes a stored profile.
			await apiGet("organization.myCapabilities", undefined, { apiUrl, apiKey });

			const profileName = options.profile ?? activeProfileName();
			writeProfile(profileName, {
				apiUrl,
				apiKey,
				...(options.organizationId ? { organizationId: options.organizationId } : {}),
			});
			printResult(
				{ ok: true, profile: profileName, apiUrl, configPath: configPath() },
				`Logged in to ${apiUrl} as profile "${profileName}" (${configPath()}).`,
			);
		},
	);

	addOutputOptions(
		auth.command("status").description("Check that the stored credentials still work"),
	).action(async () => {
		const profile = activeProfileName();
		const me = await apiGet<MyCapabilities>("organization.myCapabilities");
		printRecord({
			ok: true,
			profile,
			apiUrl: readProfile(profile)?.apiUrl ?? process.env.NIXPLOY_API_URL ?? "",
			role: me.role,
			capabilities: me.capabilities.length,
		});
	});

	addOutputOptions(
		auth.command("whoami").description("Show the organization and capabilities behind the key"),
	).action(async () => {
		const [settings, me] = await Promise.all([
			apiGet<{ id: string; name: string }>("organization.settings"),
			apiGet<MyCapabilities>("organization.myCapabilities"),
		]);
		printRecord({
			profile: activeProfileName(),
			organizationId: settings.id,
			organizationName: settings.name,
			role: me.role,
			capabilities: me.capabilities.join(", "),
		});
	});

	addOutputOptions(auth.command("profiles").description("List stored profiles")).action(() => {
		const active = activeProfileName();
		const rows = Object.entries(listProfiles()).map(([name, profile]) => ({
			profile: name,
			active: name === active,
			apiUrl: profile.apiUrl,
			organizationId: profile.organizationId ?? "",
		}));
		printList(rows, ["profile", "active", "apiUrl", "organizationId"]);
	});

	addOutputOptions(
		auth
			.command("logout")
			.description("Delete a stored profile")
			.option("--profile <name>", "Profile to delete (default: the active profile)"),
	).action((options: { profile?: string }) => {
		const name = options.profile ?? activeProfileName();
		if (!removeProfile(name)) {
			throw new CliError(`No stored profile named "${name}".`);
		}
		printResult({ ok: true, profile: name }, `Removed profile "${name}".`);
	});

	return auth;
}
