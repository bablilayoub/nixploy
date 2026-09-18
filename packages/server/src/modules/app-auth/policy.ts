import { z } from "zod";
import { ORG_ROLE_RANK, type OrgRole } from "../projects/roles";

/**
 * Forward-auth policy: who may reach a protected domain.
 *
 * Pure module — no database, no crypto, no Traefik. Everything here is a
 * decision about an identity that somebody else resolved, which is what makes
 * "would this person get in?" testable without a request.
 *
 * The baseline is **membership of the organization that owns the domain**.
 * Every field below narrows that further, and an empty field means "do not
 * narrow on this" — never "allow nobody". The one exception is deliberate:
 * a `teams` list with no entries is the same as absent, because a policy that
 * locked everyone out would be indistinguishable from a misconfiguration and
 * the operator would be locked out of the app they just protected.
 */

/** Path prefix a request may take without authenticating at all. */
const bypassPathSchema = z
	.string()
	.min(1)
	.max(256)
	.regex(/^\/[A-Za-z0-9\-._~/%]*$/, "Bypass path must start with / and be a plain URL path")
	.refine((value) => !value.includes(".."), "Bypass path must not contain ..");

/**
 * A DNS domain for the email allow-list. Matched exactly against the part
 * after the `@` — `endsWith` would admit `notexample.com` for `example.com`.
 */
const emailDomainSchema = z
	.string()
	.min(3)
	.max(253)
	.regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i, "Not a domain name")
	.transform((value) => value.toLowerCase());

export const nixployAuthConfigSchema = z.object({
	/** Minimum organization role. Absent means "any member". */
	minRole: z.enum(["viewer", "member", "deployer", "admin", "owner"]).optional(),
	/** Team ids; a member of ANY of them passes. Empty/absent does not narrow. */
	teamIds: z.array(z.string().min(1).max(64)).max(50).optional(),
	/** User ids; an exact match passes regardless of role. Empty does not narrow. */
	userIds: z.array(z.string().min(1).max(64)).max(200).optional(),
	/** Email domains; empty does not narrow. */
	emailDomains: z.array(emailDomainSchema).max(50).optional(),
	/** Prefixes served without authentication (health checks, webhooks). */
	bypassPaths: z.array(bypassPathSchema).max(20).optional(),
	/** Send `X-Forwarded-User` / `-Email` / `-Groups` upstream. */
	injectHeaders: z.boolean().optional(),
	/** Cookie lifetime. 12 hours by default, 7 days at most. */
	sessionHours: z.number().int().min(1).max(168).optional(),
});

export type NixployAuthConfig = z.infer<typeof nixployAuthConfigSchema>;

/** Default cookie lifetime in hours. */
export const DEFAULT_SESSION_HOURS = 12;

/** Who is asking. Resolved from the panel session by `modules/app-auth`. */
export interface AppAuthIdentity {
	userId: string;
	email: string;
	name: string | null;
	/** Role in the organization that owns the domain; null when not a member. */
	role: OrgRole | null;
	/** Teams in that organization, with names for the `X-Forwarded-Groups` header. */
	teams: readonly { teamId: string; name: string }[];
	/**
	 * Whether the project this app lives in is one the caller can reach
	 * (`member.project_scope`). A member who cannot open the project in the
	 * panel must not be let into its app by a different door.
	 */
	projectVisible: boolean;
}

/** Groups handed upstream: the organization role plus every team name. */
export const groupsOf = (identity: AppAuthIdentity): string[] =>
	identity.role ? [identity.role, ...identity.teams.map((team) => team.name)] : [];

export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

/** Everything after the last `@`, lowercased; null when the address is odd. */
export const emailDomainOf = (email: string): string | null => {
	const at = email.lastIndexOf("@");
	if (at <= 0 || at === email.length - 1) return null;
	return email.slice(at + 1).toLowerCase();
};

/**
 * Does this request path skip authentication?
 *
 * Prefix match on the path only — the query string is ignored, and a bypass
 * of `/healthz` also covers `/healthz/live`. `..` is refused at validation, so
 * a prefix cannot be walked out of.
 */
export const isBypassPath = (
	uri: string | null | undefined,
	bypassPaths: readonly string[] | undefined,
): boolean => {
	if (!bypassPaths?.length) return false;
	const path = (uri ?? "/").split("?")[0] ?? "/";
	// A decoded path, so `%2e%2e` cannot hide a traversal from the comparison.
	let decoded = path;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		// Malformed escapes: compare the raw form rather than trusting a guess.
	}
	if (decoded.includes("..")) return false;
	return bypassPaths.some(
		(prefix) =>
			decoded === prefix || decoded.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
	);
};

/**
 * Decide whether an identity may reach a protected domain.
 *
 * Order matters for the message, not the answer: "you are not in this
 * organization" is a different problem from "your team is not on the list",
 * and an operator debugging a lockout needs to know which.
 */
export function evaluateAppAuthPolicy(
	config: NixployAuthConfig,
	identity: AppAuthIdentity,
): PolicyDecision {
	if (!identity.role) {
		return {
			allowed: false,
			reason: "You are not a member of the organization that owns this app.",
		};
	}

	// Teams narrow which projects a member reaches, and this app lives in one
	// of them. Checked before every allow below — including the explicit user
	// grant — so the app's own hostname cannot become a second door into a
	// project the panel hides.
	if (!identity.projectVisible) {
		return { allowed: false, reason: "This app is in a project your teams do not reach." };
	}

	// An explicit user id is a grant, not a filter: it is how an operator adds
	// one person without loosening the role or team rules for everybody.
	if (config.userIds?.includes(identity.userId)) return { allowed: true };

	if (config.minRole) {
		const need = ORG_ROLE_RANK[config.minRole];
		const have = ORG_ROLE_RANK[identity.role];
		if (have < need) {
			return {
				allowed: false,
				reason: `This app requires the ${config.minRole} role or higher; you are a ${identity.role}.`,
			};
		}
	}

	if (config.teamIds?.length) {
		const inTeam = identity.teams.some((team) => config.teamIds?.includes(team.teamId));
		if (!inTeam) {
			return { allowed: false, reason: "This app is restricted to teams you are not a member of." };
		}
	}

	if (config.emailDomains?.length) {
		const domain = emailDomainOf(identity.email);
		if (!domain || !config.emailDomains.includes(domain)) {
			return { allowed: false, reason: "Your email domain is not allowed to reach this app." };
		}
	}

	return { allowed: true };
}

/** Headers handed upstream when `injectHeaders` is on. */
export const AUTH_RESPONSE_HEADERS = [
	"X-Forwarded-User",
	"X-Forwarded-Email",
	"X-Forwarded-Groups",
] as const;
