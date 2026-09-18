import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { domainMiddlewares, domains, members, teamMembers, teams } from "../../db/schema";
import { createTtlCache, type TtlCache } from "../../utils/ttl-cache";
import { resolveProjectFilter } from "../projects/project-scope";
import type { OrgRole } from "../projects/roles";
import { type AppAuthIdentity, type NixployAuthConfig, nixployAuthConfigSchema } from "./policy";

/**
 * The database half of forward-auth: which policy guards a host, and what the
 * signed-in person is in the organization that owns it.
 *
 * `policy.ts` decides, `tokens.ts` signs, this resolves. Kept apart because
 * the first two are on the hot path of every proxied request and must stay
 * testable without a database.
 */

export * from "./policy";
export * from "./tokens";

/**
 * Does a forwarded host belong to this policy's domain row?
 *
 * The open-redirect guard for the whole flow: the host arrives from
 * `X-Forwarded-Host` and again as a query parameter, and it decides where the
 * browser is sent next. A wildcard row (`*.example.com`) covers exactly one
 * further label — the same shape Traefik's own rule matches — so a policy on
 * `*.example.com` never authorises `evil.com` or `a.b.example.com`.
 */
export function hostMatchesDomain(policyHost: string, forwardedHost: string): boolean {
	const candidate = forwardedHost.trim().toLowerCase().split(":")[0] ?? "";
	if (!candidate) return false;
	const pattern = policyHost.trim().toLowerCase();
	if (!pattern.startsWith("*.")) return pattern === candidate;
	const zone = pattern.slice(2);
	if (!candidate.endsWith(`.${zone}`)) return false;
	const label = candidate.slice(0, -(zone.length + 1));
	return label.length > 0 && !label.includes(".");
}

/**
 * Public origin of the panel, for the redirect that leaves the protected host.
 *
 * Deliberately NOT derived from the incoming request: forward-auth requests
 * arrive from Traefik with the panel's internal service name in `Host`, and a
 * redirect to `http://nixploy:3000` resolves nowhere in a browser.
 */
export async function panelPublicOrigin(): Promise<string | null> {
	const { getDashboardDomain } = await import("../traefik/dashboard");
	const domain = await getDashboardDomain().catch(() => null);
	if (domain) return `https://${domain}`;
	const env = process.env.BETTER_AUTH_URL?.trim() || process.env.NIXPLOY_BASE_URL?.trim();
	return env ? env.replace(/\/+$/, "") : null;
}

export interface ProtectedDomain {
	domainId: string;
	host: string;
	organizationId: string;
	/** The project the app lives in, for the team check. */
	projectId: string;
	config: NixployAuthConfig;
}

/**
 * Load the `nixployAuth` policy for one domain row.
 *
 * Keyed by domain id rather than by host: the middleware address carries the
 * id, so two rows on the same host (different paths, different ports) keep
 * their own policies, and a host cannot be spoofed into a policy that is not
 * its own — the row is re-checked against the forwarded host by the caller.
 */
/**
 * Policy cache.
 *
 * `verify` runs on EVERY request to a protected host — every page, every
 * asset — so two queries per request would put a busy app's traffic on the
 * panel's database. Ten seconds is short enough that an operator who tightens
 * a policy does not have to wonder, and `saveMiddlewares` invalidates on the
 * way past anyway. Process-local on `globalThis`, like every other singleton
 * in this package (`transpilePackages` evaluates it twice).
 */
const globalForPolicies = globalThis as typeof globalThis & {
	__nixployAppAuthPolicies?: TtlCache<ProtectedDomain | null>;
};
globalForPolicies.__nixployAppAuthPolicies ??= createTtlCache<ProtectedDomain | null>({
	ttlMs: 10_000,
});
const policyCache = globalForPolicies.__nixployAppAuthPolicies;

/** Drop a domain's cached policy after a middleware write. */
export const invalidateProtectedDomain = (domainId: string): void =>
	policyCache.invalidate(domainId);

export const loadProtectedDomain = (domainId: string): Promise<ProtectedDomain | null> =>
	policyCache.get(domainId, () => readProtectedDomain(domainId));

async function readProtectedDomain(domainId: string): Promise<ProtectedDomain | null> {
	const row = await db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	if (!row) return null;
	const project = row.application?.environment.project ?? row.compose?.environment.project;
	if (!project) return null;

	const middleware = await db.query.domainMiddlewares.findFirst({
		where: and(
			eq(domainMiddlewares.domainId, domainId),
			eq(domainMiddlewares.kind, "nixployAuth"),
			eq(domainMiddlewares.enabled, true),
		),
	});
	if (!middleware) return null;

	// Re-parse on read. A row written under looser validation must not be able
	// to widen a policy the current rules would reject.
	const parsed = nixployAuthConfigSchema.safeParse(middleware.config ?? {});
	if (!parsed.success) return null;

	return {
		domainId,
		host: row.host.toLowerCase(),
		organizationId: project.organizationId,
		projectId: project.projectId,
		config: parsed.data,
	};
}

/**
 * The caller's standing in the organization that owns the domain.
 *
 * A non-member resolves to `role: null`, which the policy turns into a refusal
 * — membership is the baseline every rule narrows from, so "not a member" is
 * answered here rather than by each rule failing for its own reason.
 */
export async function resolveAppAuthIdentity(
	user: { id: string; email: string; name?: string | null },
	organizationId: string,
	projectId: string,
): Promise<AppAuthIdentity> {
	const filter = await resolveProjectFilter(user.id);
	const projectVisible = filter.kind === "all" || filter.projectIds.has(projectId);
	const membership = await db.query.members.findFirst({
		where: and(eq(members.userId, user.id), eq(members.organizationId, organizationId)),
		columns: { role: true },
	});
	if (!membership) {
		return {
			userId: user.id,
			email: user.email,
			name: user.name ?? null,
			role: null,
			teams: [],
			projectVisible,
		};
	}
	// Names come back with the ids because they are the `X-Forwarded-Groups`
	// value an upstream app matches on; resolving them later would be a second
	// query on the same rows.
	const rows = await db
		.select({ teamId: teams.teamId, name: teams.name })
		.from(teamMembers)
		.innerJoin(teams, eq(teams.teamId, teamMembers.teamId))
		.where(and(eq(teamMembers.userId, user.id), eq(teams.organizationId, organizationId)));

	return {
		userId: user.id,
		email: user.email,
		name: user.name ?? null,
		role: membership.role as OrgRole,
		teams: rows,
		projectVisible,
	};
}
