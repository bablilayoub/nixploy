import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, environments, members, projects, teams } from "../../db/schema";
import { assertSafeOutboundUrl } from "../../utils/public-url";
import type { NixployAuthConfig } from "../app-auth/policy";
import { badRequest } from "../errors";
import { projectIdFilter } from "../projects/project-scope";
import { parseForwardAuthAddress } from "./middlewares";

/**
 * Organization-bound checks on middleware configs. `parseMiddlewareConfig`
 * validates the shape; these validate what the values point at. Shared by
 * the domain router and the GitOps apply so a manifest cannot attach what the
 * form refuses.
 */

/**
 * SSRF gate for `forwardAuth.address`. Two shapes are allowed:
 * - a bare container/service name (`http://authelia:9091/api/verify`) that
 *   belongs to an application or compose stack of the **same organization** —
 *   it never resolves in the panel's DNS, so the generic guard cannot see it;
 * - any other URL, which goes through `assertSafeOutboundUrl` with private
 *   ranges denied (no loopback, no RFC1918, no metadata).
 */
export const assertForwardAuthAllowed = async (
	address: string,
	organizationId: string,
): Promise<void> => {
	const target = parseForwardAuthAddress(address);
	if (target.scope === "external") {
		try {
			await assertSafeOutboundUrl(target.url.toString(), { allowPrivate: false });
		} catch (error) {
			throw badRequest(
				"forwardAuth must point at a public HTTPS endpoint or another service of this organization",
				error,
			);
		}
		return;
	}
	// Project-filtered as well as org-filtered: accepting a name the caller
	// cannot otherwise see turns this validator into an existence oracle.
	const [applicationRows, composeRows] = await Promise.all([
		db
			.select({ appName: applications.appName })
			.from(applications)
			.innerJoin(environments, eq(applications.environmentId, environments.environmentId))
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(and(eq(projects.organizationId, organizationId), projectIdFilter(projects.projectId))),
		db
			.select({ appName: compose.appName })
			.from(compose)
			.innerJoin(environments, eq(compose.environmentId, environments.environmentId))
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(and(eq(projects.organizationId, organizationId), projectIdFilter(projects.projectId))),
	]);
	const host = target.host;
	const owned =
		applicationRows.some((row) => row.appName.toLowerCase() === host) ||
		// Compose containers are `<appName>-<service>-1`.
		composeRows.some((row) => {
			const appName = row.appName.toLowerCase();
			return host === appName || host.startsWith(`${appName}-`);
		});
	if (!owned) {
		throw badRequest(
			`No service named “${host}” in this organization. Use the app name of a service you own, or a public HTTPS URL.`,
		);
	}
};

/**
 * Validate a panel forward-auth policy against the organization that owns the
 * domain.
 *
 * A team or a user id from another tenant would not *grant* anything — the
 * policy is evaluated against the caller's membership of this organization, so
 * a foreign id simply never matches — but storing one would let an operator
 * enumerate ids by watching which ones the form accepted, and it would quietly
 * lock a policy that looks configured. Both are refused.
 */
export async function assertNixployAuthAllowed(
	config: NixployAuthConfig,
	organizationId: string,
): Promise<void> {
	if (config.teamIds?.length) {
		const owned = await db
			.select({ teamId: teams.teamId })
			.from(teams)
			.where(and(eq(teams.organizationId, organizationId), inArray(teams.teamId, config.teamIds)));
		const known = new Set(owned.map((row) => row.teamId));
		const missing = config.teamIds.filter((teamId) => !known.has(teamId));
		if (missing.length > 0) {
			throw badRequest("One or more teams do not belong to this organization");
		}
	}
	if (config.userIds?.length) {
		const owned = await db
			.select({ userId: members.userId })
			.from(members)
			.where(
				and(eq(members.organizationId, organizationId), inArray(members.userId, config.userIds)),
			);
		const known = new Set(owned.map((row) => row.userId));
		const missing = config.userIds.filter((userId) => !known.has(userId));
		if (missing.length > 0) {
			throw badRequest("One or more users are not members of this organization");
		}
	}
}
