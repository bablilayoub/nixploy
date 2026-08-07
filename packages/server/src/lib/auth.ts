import { apiKey } from "@better-auth/api-key";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, organization, twoFactor } from "better-auth/plugins";
import { db, schema } from "../db";
import type { invitations, members } from "../db/schema";
import { recordAudit } from "../modules/audit";
import { canSignUpEmail, hasAnyUsers } from "../modules/auth/setup";
import { deleteOrganizationCascade } from "../modules/projects";
import { orgAc, orgPluginRoles } from "./org-roles";

type MemberRow = typeof members.$inferSelect;
type InvitationRow = typeof invitations.$inferSelect;

const BCRYPT_ROUNDS = 10;

/**
 * Trusted origins must include the dashboard domain configured at runtime in
 * web-server settings (Settings → Platform), otherwise sign-in from that
 * domain fails better-auth's origin check. Cached briefly — a settings save
 * becomes effective within seconds without a restart.
 */
const envOrigins = process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : [];
let originsCache: { at: number; origins: string[] } = { at: 0, origins: [] };
const trustedOriginsWithDashboardDomain = async (): Promise<string[]> => {
	if (Date.now() - originsCache.at > 15_000) {
		let origins: string[] = [];
		try {
			const [row] = await db.select().from(schema.webServerSettings).limit(1);
			const host = row?.host?.trim().toLowerCase();
			if (host) {
				origins = [`https://${host}`, `http://${host}`];
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
		// first admin only, or a pending organization invitation.
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
		},
	},
	plugins: [
		organization({
			ac: orgAc,
			roles: orgPluginRoles,
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
			},
		}),
		admin(),
		twoFactor(),
		apiKey({
			enableMetadata: true,
		}),
	],
	trustedOrigins: () => trustedOriginsWithDashboardDomain(),
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					const email = typeof user.email === "string" ? user.email : "";
					if (!(await canSignUpEmail(email))) {
						throw new APIError("FORBIDDEN", {
							message: "Registration is disabled. Ask an admin to invite you, or sign in.",
						});
					}
					const isFirst = !(await hasAnyUsers());
					return {
						data: {
							...user,
							...(isFirst ? { role: "admin" } : {}),
						},
					};
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
