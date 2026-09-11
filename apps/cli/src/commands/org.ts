import type { Command } from "commander";
import { apiGet } from "../client.js";
import { activeProfileName, listProfiles, updateActiveProfile } from "../config.js";
import { addOutputOptions, printList, printRecord, printResult } from "../utils/output.js";

/** `organization.myCapabilities` — effective role plus the capability ids. */
export interface MyCapabilities {
	organizationId: string;
	role: string;
	capabilities: string[];
}

/**
 * Organization selection for multi-org API keys.
 *
 * An API key resolves to exactly one organization per request: the one stored
 * in the key's metadata when it is bound, otherwise the `x-organization-id`
 * header, otherwise the user's first membership
 * (`packages/server/src/lib/api-key-context.ts`). `org use` writes that header
 * value into the active profile; there is no tRPC procedure that enumerates a
 * user's memberships yet, so `org list` reports what the profiles know plus the
 * organization the key currently resolves to.
 */
export function augmentOrgCommand(org: Command): Command {
	addOutputOptions(
		org.command("current").description("Organization this API key resolves to right now"),
	).action(async () => {
		const [settings, me] = await Promise.all([
			apiGet<{ id: string; name: string; slug?: string }>("organization.settings"),
			apiGet<MyCapabilities>("organization.myCapabilities").catch(() => null),
		]);
		printRecord({
			organizationId: settings.id,
			name: settings.name,
			slug: settings.slug ?? "",
			profile: activeProfileName(),
			role: me?.role ?? "",
			capabilities: me?.capabilities.length ?? 0,
		});
	});

	addOutputOptions(
		org.command("list").description("Organizations reachable from the stored profiles"),
	).action(async () => {
		const current = await apiGet<{ id: string; name: string }>("organization.settings").catch(
			() => null,
		);
		const active = activeProfileName();
		const rows = Object.entries(listProfiles()).map(([name, profile]) => ({
			organizationId:
				profile.organizationId ?? (name === active ? (current?.id ?? "") : "(key default)"),
			name: name === active ? (current?.name ?? "") : "",
			profile: name,
			active: name === active,
			apiUrl: profile.apiUrl,
		}));
		printList(rows, ["organizationId", "name", "profile", "active", "apiUrl"]);
	});

	addOutputOptions(
		org
			.command("use")
			.description("Pin the active profile to an organization (sent as x-organization-id)")
			.argument("[organizationId]", "Organization ID; omit with --clear"),
	)
		.option("--clear", "Stop pinning and fall back to the key's default organization")
		.action(async (organizationId: string | undefined, options: { clear?: boolean }) => {
			if (options.clear) {
				const profile = updateActiveProfile({ organizationId: undefined });
				printResult(
					{ ok: true, profile: activeProfileName(), apiUrl: profile.apiUrl },
					"Organization pin cleared.",
				);
				return;
			}
			if (!organizationId) {
				const current = await apiGet<{ id: string; name: string }>("organization.settings");
				printResult(
					{ organizationId: current.id, name: current.name },
					`Currently using ${current.name} (${current.id}). Pass an organization ID to pin another.`,
				);
				return;
			}
			updateActiveProfile({ organizationId });
			// Confirm the pin actually resolves before declaring success.
			const settings = await apiGet<{ id: string; name: string }>("organization.settings");
			printResult(
				{ ok: true, organizationId: settings.id, name: settings.name },
				`Profile "${activeProfileName()}" now uses ${settings.name} (${settings.id}).`,
			);
		});

	return org;
}
