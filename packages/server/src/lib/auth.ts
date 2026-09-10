import { apiKey } from "@better-auth/api-key";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { client, db, schema } from "../db";
import type { invitations, members } from "../db/schema";
import { recordAudit } from "../modules/audit";
import { isInstanceAdminRole } from "../modules/auth/instance-admin";
import {
	assertInviteRoleBelowCaller,
	assertMemberActionRank,
	loadCallerMembership,
} from "../modules/auth/org-rank";
import { canSignUpWithInvitation, hasAnyUsers, INVITATION_ID_HEADER } from "../modules/auth/setup";
import { deleteOrganizationCascade, hasCapability } from "../modules/projects";
import { trustedProxyCidrsForAuth } from "../utils/rate-limit";
import { orgAc, orgPluginRoles } from "./org-roles";

type MemberRow = typeof members.$inferSelect;
type InvitationRow = typeof invitations.$inferSelect;

/** Postgres advisory lock id for serializing first-admin signup (TOCTOU). */
const FIRST_USER_LOCK_KEY = 872_314_01;

const BCRYPT_ROUNDS = 10;

/**
 * Trusted origins must include the dashboard domain configured at runtime in
 * web-server settings (Settings → Platform), otherwise sign-in from that
 * domain fails better-auth's origin check. Cached briefly — a settings save
 * becomes effective within seconds without a restart.
 */
const envOrigins = process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : [];
let originsCache: { at: number; origins: string[] } = { at: 0, origins: [] };

const isLoopbackHost = (host: string): boolean =>
	host === "localhost" ||
	host === "127.0.0.1" ||
	host === "[::1]" ||
	host.startsWith("127.") ||
	host.endsWith(".localhost");

export const trustedOriginsWithDashboardDomain = async (): Promise<string[]> => {
	if (Date.now() - originsCache.at > 15_000) {
		let origins: string[] = [];
		try {
			const [row] = await db.select().from(schema.webServerSettings).limit(1);
			const host = row?.host?.trim().toLowerCase();
			if (host) {
				origins = [`https://${host}`];
				// Allow plain HTTP only for loopback or explicit development.
				if (isLoopbackHost(host) || process.env.NODE_ENV === "development") {
					origins.push(`http://${host}`);
				}
			}
		} catch {
			// Table may not exist yet (first migration run) — fall back to env.
		}
		originsCache = { at: Date.now(), origins };
	}
	return [...envOrigins, ...originsCache.origins];
};

export const auth = betterAuth({
	appName: "Nixploy",
	baseURL: process.env.BETTER_AUTH_URL,
	secret: process.env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, {
		provider: "pg",
		// The drizzle adapter looks tables up by better-auth model name
		// (singular), while the schema barrel exports them plural.
		schema: {
			user: schema.users,
			session: schema.sessions,
			account: schema.accounts,
			verification: schema.verifications,
			organization: schema.organizations,
			member: schema.members,
			invitation: schema.invitations,
			apikey: schema.apikeys,
			twoFactor: schema.twoFactors,
		},
	}),
	emailAndPassword: {
		enabled: true,
		autoSignIn: true,
		minPasswordLength: 8,
		// Public self-serve registration is gated in user.create.before:
		// first admin only, or the holder of a pending organization invitation
		// (the accept page sends its id in INVITATION_ID_HEADER).
		password: {
			hash: (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
			verify: ({ password, hash }) => bcrypt.compare(password, hash),
		},
	},
	// A self-hosted panel is usually reachable from the internet, so throttle
	// credential guessing. Sign-in and 2FA verification get a tighter window
	// than the rest of the auth surface.
	rateLimit: {
		enabled: true,
		window: 60,
		max: 60,
		customRules: {
			"/sign-in/email": { window: 60, max: 10 },
			"/two-factor/verify-totp": { window: 60, max: 10 },
			"/two-factor/verify-backup-code": { window: 60, max: 10 },
			"/forget-password": { window: 300, max: 5 },
			"/reset-password": { window: 300, max: 5 },
			// Read-only routes the dashboard calls on every navigation. better-auth
			// keys its limiter by client IP + path (or one shared bucket when no
			// trusted proxy resolves an IP), so the 60/min default throttled a
			// single team hard-refreshing the panel.
			"/get-session": { window: 60, max: 600 },
			"/list-sessions": { window: 60, max: 120 },
			"/organization/*": { window: 60, max: 300 },
			"/api-key/*": { window: 60, max: 120 },
		},
	},
	plugins: [
		organization({
			ac: orgAc,
			roles: orgPluginRoles,
			// Only instance admins may create additional orgs on a shared host
			// (invited viewers must not self-escalate to a new owner tenant).
			allowUserToCreateOrganization: async (user) => isInstanceAdminRole(user.role),
			organizationHooks: {
				// Real infra (Swarm services, Traefik configs, volumes, on-disk
				// state) must be torn down while rows still exist — Postgres FK
				// cascades on the organization row only ever remove DB rows.
				// Not written to the audit log: it is scoped to this org and
				// would cascade-delete along with everything else immediately.
				beforeDeleteOrganization: async ({ organization, user }) => {
					console.log(
						`Deleting organization "${organization.name}" (${organization.id}), requested by ${user.email}`,
					);
					await deleteOrganizationCascade(organization.id);
				},
				beforeCreateInvitation: async ({ invitation, inviter, organization }) => {
					if (!(await hasCapability(inviter.id, organization.id, "members.manage"))) {
						throw new APIError("FORBIDDEN", {
							message: 'This action requires the "members.manage" capability',
						});
					}
					const caller = await loadCallerMembership(inviter.id, organization.id);
					assertInviteRoleBelowCaller(caller.role, String(invitation.role ?? "member"));
				},
				beforeUpdateMemberRole: async ({ member, newRole, user, organization }) => {
					if (!(await hasCapability(user.id, organization.id, "members.manage"))) {
						throw new APIError("FORBIDDEN", {
							message: 'This action requires the "members.manage" capability',
						});
					}
					await assertMemberActionRank({
						actorUserId: user.id,
						organizationId: organization.id,
						targetMemberRole: String(member.role),
						newRole: String(newRole),
					});
				},
				beforeRemoveMember: async ({ member, user, organization }) => {
					if (!(await hasCapability(user.id, organization.id, "members.manage"))) {
						throw new APIError("FORBIDDEN", {
							message: 'This action requires the "members.manage" capability',
						});
					}
					await assertMemberActionRank({
						actorUserId: user.id,
						organizationId: organization.id,
						targetMemberRole: String(member.role),
					});
				},
			},
		}),
		admin(),
		twoFactor(),
		apiKey({
			enableMetadata: true,
			rateLimit: {
				enabled: true,
				timeWindow: 60_000,
				maxRequests: 120,
			},
		}),
	],
	trustedOrigins: () => trustedOriginsWithDashboardDomain(),
	advanced: {
		ipAddress: {
			// Keep better-auth's limiter and ours (utils/rate-limit.ts) resolving
			// the same client IP: both read TRUSTED_PROXIES.
			trustedProxies: trustedProxyCidrsForAuth(),
		},
	},
	databaseHooks: {
		user: {
			create: {
				before: async (user, ctx) => {
					const email = typeof user.email === "string" ? user.email : "";
					// Session-level advisory locks are per connection, so lock and
					// unlock must run on the same one: reserve it from the pool
					// instead of issuing both through the pooled `db`.
					const reserved = await client.reserve();
					try {
						await reserved`SELECT pg_advisory_lock(${FIRST_USER_LOCK_KEY})`;
						try {
							const isFirst = !(await hasAnyUsers());
							if (!isFirst) {
								const invitationId =
									ctx?.headers?.get(INVITATION_ID_HEADER) ??
									ctx?.request?.headers?.get(INVITATION_ID_HEADER) ??
									null;
								if (!(await canSignUpWithInvitation(email, invitationId))) {
									throw new APIError("FORBIDDEN", {
										message: "Registration is disabled. Ask an admin to invite you, or sign in.",
									});
								}
							}
							return {
								data: {
									...user,
									...(isFirst ? { role: "admin" } : {}),
								},
							};
						} finally {
							await reserved`SELECT pg_advisory_unlock(${FIRST_USER_LOCK_KEY})`;
						}
					} finally {
						reserved.release();
					}
				},
			},
		},
		session: {
			create: {
				// New sign-in sessions get no activeOrganizationId from the
				// organization plugin — default it to the user's first
				// membership so org-scoped routers work immediately.
				before: async (session) => {
					if (session.activeOrganizationId) {
						return { data: session };
					}
					const membership = await db.query.members.findFirst({
						where: (m, { eq }) => eq(m.userId, session.userId),
						orderBy: (m, { asc }) => asc(m.createdAt),
					});
					return {
						data: {
							...session,
							activeOrganizationId: membership?.organizationId ?? null,
						},
					};
				},
			},
		},
		member: {
			create: {
				after: async (member: MemberRow) => {
					await recordAudit({
						organizationId: member.organizationId,
						actorId: member.userId,
						action: "member.join",
						targetType: "member",
						targetId: member.id,
					});
				},
			},
			update: {
				after: async (member: MemberRow) => {
					await recordAudit({
						organizationId: member.organizationId,
						actorId: member.userId,
						action: "member.role",
						targetType: "member",
						targetId: member.id,
						metadata: { role: member.role },
					});
				},
			},
			delete: {
				after: async (member: MemberRow) => {
					await recordAudit({
						organizationId: member.organizationId,
						actorId: member.userId,
						action: "member.remove",
						targetType: "member",
						targetId: member.id,
					});
				},
			},
		},
		invitation: {
			create: {
				after: async (invitation: InvitationRow) => {
					await recordAudit({
						organizationId: invitation.organizationId,
						actorId: invitation.inviterId,
						action: "member.invite",
						targetType: "invitation",
						targetId: invitation.id,
						targetName: invitation.email,
						metadata: { role: invitation.role },
					});
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
