import type { Command } from "commander";
import { apiGet } from "../client.js";
import { activeProfileName, updateActiveProfile } from "../config.js";
import { notFoundError } from "../errors.js";
import { addOutputOptions, printRecord, printResult } from "../utils/output.js";

/** `organization.myCapabilities` — effective role plus the capability ids. */
export interface MyCapabilities {
	organizationId: string;
	role: string;
	capabilities: string[];
}

/** One row of `organization.list` — a membership of the API key's user. */
export interface OrganizationMembership {
	organizationId: string;
	name: string;
	slug: string;
	role: string;
	active: boolean;
}

/**
 * Organization selection for multi-org API keys.
 *
 * An API key resolves to exactly one organization per request: the one stored
 * in the key's metadata when it is bound, otherwise the `x-organization-id`
 * header, otherwise the user's first membership
 * (`packages/server/src/lib/api-key-context.ts`). `org use` (alias `switch`)
 * writes that header value into the active profile, and `organization.list`
 * enumerates the memberships it may legally point at — before that procedure
 * existed this command could only guess from the stored profiles.
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
		org
			.command("use")
			.alias("switch")
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
			const memberships = await apiGet<OrganizationMembership[]>("organization.list");
			if (!organizationId) {
				const current = memberships.find((row) => row.active);
				printResult(
					current ?? { organizationId: null },
					current
						? `Currently using ${current.name} (${current.organizationId}). Pass an organization ID to pin another — \`nixploy org list\` shows them all.`
						: "This key resolves to no organization. `nixploy org list` shows the memberships.",
				);
				return;
			}
			// Fail before writing the profile: a pin the key cannot use would
			// otherwise break every later command with a FORBIDDEN.
			const target = memberships.find((row) => row.organizationId === organizationId);
			if (!target) {
				throw notFoundError(
					`Not a member of "${organizationId}". Available: ${
						memberships.map((row) => `${row.name} (${row.organizationId})`).join(", ") || "none"
					}`,
				);
			}
			updateActiveProfile({ organizationId });
			printResult(
				{ ok: true, organizationId: target.organizationId, name: target.name, role: target.role },
				`Profile "${activeProfileName()}" now uses ${target.name} (${target.organizationId}).`,
			);
		});

	return org;
}
