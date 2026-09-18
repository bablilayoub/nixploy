import { apiKey } from "@better-auth/api-key";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, genericOAuth, organization, twoFactor } from "better-auth/plugins";
import { client, db, schema } from "../db";
import type { invitations, members } from "../db/schema";
import { recordAudit } from "../modules/audit";
import {
	type AuthHookContext,
	handleAuthEventAfter,
	loginLockoutFor,
	loginLockoutMessage,
} from "../modules/auth/auth-events";
import { isInstanceAdminRole } from "../modules/auth/instance-admin";
import {
	assertInviteRoleBelowCaller,
	assertMemberActionRank,
	loadCallerMembership,
} from "../modules/auth/org-rank";
import {
	EMAIL_NOT_CONFIGURED_MESSAGE,
	hasInstanceEmailProvider,
	sendPasswordResetEmail,
} from "../modules/auth/password-reset";
import {
	canSignUpWithInvitation,
	hasAnyUsers,
	INVITATION_ID_HEADER,
	requiresSetupToken,
	SETUP_TOKEN_HEADER,
	setupTokenMatches,
} from "../modules/auth/setup";
import {
	extractGroups,
	isEmailDomainAllowed,
	isSsoRequestPath,
	loadSsoProviders,
	provisionSsoMembership,
	type SsoProviderConfig,
	seedSsoProvidersFromEnv,
	syncSsoMemberRole,
} from "../modules/auth/sso";
import { readStoredIdTokenClaims } from "../modules/auth/sso-claims";
import { deleteOrganizationCascade, hasCapability } from "../modules/projects";
import { trustedProxyCidrsForAuth } from "../utils/rate-limit";
import { createLogger } from "./logger";
import { orgAc, orgPluginRoles } from "./org-roles";

type MemberRow = typeof members.$inferSelect;
type InvitationRow = typeof invitations.$inferSelect;

/** Postgres advisory lock id for serializing first-admin signup (TOCTOU). */
const FIRST_USER_LOCK_KEY = 872_314_01;

const authLog = createLogger("auth");

/** Email of a user id, for looking up the groups parked during the OAuth profile step. */
async function emailForUser(userId: string): Promise<string | null> {
	const row = await db.query.users.findFirst({
		where: (u, { eq }) => eq(u.id, userId),
		columns: { email: true },
	});
	return row?.email ?? null;
}

const BCRYPT_ROUNDS = 10;

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Default API-key lifetime when the caller does not pick one (90 days), and the
 * ceiling for a custom value (1 year). "Never" is reserved for instance admins
 * and requested with `metadata.neverExpires` — see the `/api-key/create`
 * pre-hook below.
 */
const API_KEY_DEFAULT_EXPIRY_SECONDS = 90 * DAY_SECONDS;
const API_KEY_MAX_EXPIRY_DAYS = 365;

/** Impersonated sessions are a break-glass tool, not a login (audit 2.2). */
const IMPERSONATION_SESSION_SECONDS = 60 * 60;

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

/**
 * Build the auth instance for a given set of SSO providers.
 *
 * better-auth freezes its plugin array at construction, so a provider saved in
 * the panel cannot take effect by itself — the instance is rebuilt instead
 * ({@link rebuildAuth}). Everything else about it is static, which is why this
 * takes only the providers.
 */
function buildAuth(ssoProviders: readonly SsoProviderConfig[]) {
	const ssoByProviderId = new Map(ssoProviders.map((entry) => [entry.providerId, entry]));
	/**
	 * The SSO provider a better-auth hook context belongs to.
	 *
	 * `ctx.path` is the route *pattern* (`/callback/:id`), not the request — so
	 * parsing it yields the literal string ":id". The concrete provider is in
	 * the route params, with the request URL as a fallback for any hook that
	 * does not carry them.
	 */
	const providerFromContext = (ctx: unknown): SsoProviderConfig | null => {
		const context = ctx as { params?: Record<string, unknown>; request?: { url?: string } } | null;
		const fromParams = context?.params?.id;
		if (typeof fromParams === "string" && ssoByProviderId.has(fromParams)) {
			return ssoByProviderId.get(fromParams) ?? null;
		}
		const url = context?.request?.url;
		if (!url) return null;
		const match = /\/(?:oauth2\/)?callback\/([^/?#]+)/.exec(url);
		const id = match?.[1];
		return id ? (ssoByProviderId.get(id) ?? null) : null;
	};

	return betterAuth({
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
			// Applies to **new** passwords only (sign-up, reset, change): sign-in
			// verification never checks length, so accounts created under the old
			// 8-character floor keep working.
			minPasswordLength: 12,
			// Public self-serve registration is gated in user.create.before:
			// first admin only, or the holder of a pending organization invitation
			// (the accept page sends its id in INVITATION_ID_HEADER).
			password: {
				hash: (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
				verify: ({ password, hash }) => bcrypt.compare(password, hash),
			},
			resetPasswordTokenExpiresIn: 60 * 60,
			// Delivered through the instance's email notification channel; with no
			// channel configured this throws and the form shows a clear message
			// instead of pretending the mail was sent.
			sendResetPassword: async ({ user, token }, request) => {
				await sendPasswordResetEmail({
					email: user.email,
					name: user.name,
					token,
					request,
				});
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
				"/request-password-reset": { window: 300, max: 5 },
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
			admin({ impersonationSessionDuration: IMPERSONATION_SESSION_SECONDS }),
			twoFactor(),
			apiKey({
				enableMetadata: true,
				// A recognisable prefix so secret scanners (GitHub, gitleaks) catch a
				// key pasted into a repository or a build log.
				defaultPrefix: "nxp_",
				keyExpiration: {
					minExpiresIn: 1,
					maxExpiresIn: API_KEY_MAX_EXPIRY_DAYS,
				},
				rateLimit: {
					enabled: true,
					timeWindow: 60_000,
					maxRequests: 120,
				},
			}),
			// SSO. genericOAuth registers each provider as a social provider, so the
			// client signs in through /sign-in/social with its providerId.
			...(ssoProviders.length > 0
				? [
						genericOAuth({
							config: ssoProviders.map((provider) => ({
								providerId: provider.providerId,
								name: provider.name,
								...(provider.discoveryUrl
									? { discoveryUrl: provider.discoveryUrl }
									: {
											authorizationUrl: provider.authorizationUrl ?? undefined,
											tokenUrl: provider.tokenUrl ?? undefined,
											userInfoUrl: provider.userInfoUrl ?? undefined,
										}),
								clientId: provider.clientId,
								clientSecret: provider.clientSecret,
								scopes: provider.scopes,
								/**
								 * Refuse a disallowed domain before the user record exists, so
								 * the IdP's response becomes a clean error instead of a
								 * provisioned account nobody can use. The same check runs
								 * again on every sign-in — this hook does not run for a user
								 * who already exists.
								 */
								mapProfileToUser: (profile: Record<string, unknown>) => {
									const email = typeof profile.email === "string" ? profile.email : "";
									if (email && !isEmailDomainAllowed(email, provider.allowedEmailDomains)) {
										throw new APIError("FORBIDDEN", {
											message: `${email.slice(email.lastIndexOf("@"))} is not allowed to sign in through ${provider.name}.`,
										});
									}
									return {};
								},
							})),
						}),
					]
				: []),
		],
		trustedOrigins: () => trustedOriginsWithDashboardDomain(),
		advanced: {
			ipAddress: {
				// Keep better-auth's limiter and ours (utils/rate-limit.ts) resolving
				// the same client IP: both read TRUSTED_PROXIES.
				trustedProxies: trustedProxyCidrsForAuth(),
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// Per-account sign-in lockout. better-auth's own limiter is per IP, so
				// a distributed run still gets 10 guesses/min/IP against one account;
				// this bucket is keyed by email (modules/auth/auth-events.ts).
				if (ctx.path === "/sign-in/email") {
					const email = typeof ctx.body?.email === "string" ? ctx.body.email : null;
					if (email) {
						const state = loginLockoutFor(email);
						if (state.locked) {
							throw new APIError("TOO_MANY_REQUESTS", { message: loginLockoutMessage(state) });
						}
					}
					return;
				}

				// better-auth answers `/request-password-reset` with a deliberately
				// vague "check your email" and runs the sender in the background, so
				// a failing send is invisible. Instance-level configuration is not
				// account information, so refuse up front when no email channel
				// exists instead of promising a mail that cannot be sent.
				if (ctx.path === "/request-password-reset" || ctx.path === "/forget-password") {
					if (!(await hasInstanceEmailProvider())) {
						throw new APIError("SERVICE_UNAVAILABLE", {
							message: EMAIL_NOT_CONFIGURED_MESSAGE,
						});
					}
					return;
				}

				// API keys expire by default. Omitting `expiresIn` means 90 days for
				// everyone; a never-expiring key must be asked for explicitly
				// (`metadata.neverExpires`) and is reserved for instance admins.
				if (ctx.path === "/api-key/create") {
					const body = (ctx.body ?? {}) as Record<string, unknown>;
					const metadata = (body.metadata ?? null) as Record<string, unknown> | null;
					const wantsNever = metadata?.neverExpires === true;
					if (wantsNever) {
						const session = await auth.api.getSession({ headers: ctx.headers ?? new Headers() });
						if (!isInstanceAdminRole(session?.user?.role)) {
							throw new APIError("FORBIDDEN", {
								message: "Only the instance admin can create API keys that never expire",
							});
						}
						return { context: { body: { ...body, expiresIn: null } } };
					}
					if (body.expiresIn === undefined || body.expiresIn === null) {
						return {
							context: { body: { ...body, expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS } },
						};
					}
				}
			}),
			// Runs for failed requests too (the endpoint's APIError lands in
			// ctx.context.returned), which is what makes auth.login.failed visible.
			after: createAuthMiddleware(async (ctx) => {
				await handleAuthEventAfter(ctx as unknown as AuthHookContext);
			}),
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user, ctx) => {
						const email = typeof user.email === "string" ? user.email : "";
						const header = (name: string) =>
							ctx?.headers?.get(name) ?? ctx?.request?.headers?.get(name) ?? null;
						// Users provisioned by the IdP are not "public registration":
						// the OIDC callback already authenticated them.
						const viaSso = ssoProviders.length > 0 && isSsoRequestPath(ctx?.path);
						// Session-level advisory locks are per connection, so lock and
						// unlock must run on the same one: reserve it from the pool
						// instead of issuing both through the pooled `db`.
						const reserved = await client.reserve();
						try {
							await reserved`SELECT pg_advisory_lock(${FIRST_USER_LOCK_KEY})`;
							try {
								const isFirst = !(await hasAnyUsers());
								if (isFirst) {
									// "First visitor wins" is a race a scanner can win on a
									// fresh host; when the installer wrote a setup token the
									// first admin must present it.
									if (requiresSetupToken() && !setupTokenMatches(header(SETUP_TOKEN_HEADER))) {
										throw new APIError("FORBIDDEN", {
											message:
												"A setup token is required to create the first admin. It is printed by the installer and stored in /etc/nixploy/.env as NIXPLOY_SETUP_TOKEN.",
										});
									}
								} else if (!viaSso) {
									const invitationId = header(INVITATION_ID_HEADER);
									if (!(await canSignUpWithInvitation(email, invitationId))) {
										throw new APIError("FORBIDDEN", {
											message: invitationId
												? "This invitation is for a different email address."
												: "Registration is disabled. Ask an admin to invite you, or sign in.",
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
					before: async (session, ctx) => {
						if (session.activeOrganizationId) {
							return { data: session };
						}
						// JIT membership for SSO: a user the IdP just provisioned (or an
						// existing one who never joined an org) lands in the provider's
						// default organization, at the role its group mapping says.
						const provider = isSsoRequestPath(ctx?.path) ? providerFromContext(ctx) : null;
						if (provider) {
							const email = await emailForUser(session.userId);
							// Groups come from the ID token better-auth already stored and
							// verified, not from `mapProfileToUser` — that hook does not run
							// for a user who already exists, so it cannot drive anything
							// that has to happen on every sign-in.
							const claims = await readStoredIdTokenClaims(
								session.userId,
								provider.providerId,
							).catch(() => null);
							const groups = extractGroups(claims, provider.groupClaim);
							// The allow-list is a standing rule, not a one-off admission
							// check: a user whose domain was removed from it must stop
							// being able to sign in, not merely stop being creatable.
							if (email && !isEmailDomainAllowed(email, provider.allowedEmailDomains)) {
								throw new APIError("FORBIDDEN", {
									message: `${email.slice(email.lastIndexOf("@"))} is not allowed to sign in through ${provider.name}.`,
								});
							}
							await provisionSsoMembership({ userId: session.userId, provider, groups });
							// Existing member, provider asks for it: re-apply the mapping so
							// a group removed in the IdP demotes them here too.
							await syncSsoMemberRole({ userId: session.userId, provider, groups }).catch(
								(error: unknown) => {
									authLog.error("SSO role sync failed", {
										error: error instanceof Error ? error.message : String(error),
									});
								},
							);
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
}

/* -------------------------------------------------------------------------- */
/*  The rebuildable instance                                                  */
/* -------------------------------------------------------------------------- */

export type Auth = ReturnType<typeof buildAuth>;

/**
 * The live instance, kept on `globalThis`.
 *
 * It starts with no SSO providers because construction is synchronous and the
 * providers live in the database; {@link initAuth} swaps in a configured one
 * during boot, a few milliseconds later, and password sign-in works
 * throughout.
 *
 * `globalThis` is not belt-and-braces here, it is the whole mechanism. Next's
 * `transpilePackages` evaluates `packages/server` twice — once for the custom
 * server, once for the route chunks — so a module-local variable would give
 * `server.ts` and `/api/auth/[...all]` two different instances, and rebuilding
 * one would leave the other still answering "Provider not found" for a
 * provider that plainly exists. Same reason as `deployment/events.ts`.
 */
const globalForAuth = globalThis as typeof globalThis & { __nixployAuth?: Auth };

function currentAuth(): Auth {
	const existing = globalForAuth.__nixployAuth;
	if (existing) return existing;
	const built = buildAuth([]);
	globalForAuth.__nixployAuth = built;
	return built;
}

/**
 * A stable reference that always forwards to whichever instance is current.
 *
 * Every consumer imports `auth` once and holds it forever, so a rebuild cannot
 * reassign a binding they already captured. Functions are bound to the real
 * instance rather than the proxy, so `auth.handler(req)` keeps whatever `this`
 * better-auth expects.
 */
export const auth: Auth = new Proxy({} as Auth, {
	get(_target, property, receiver) {
		const instance = currentAuth();
		const value = Reflect.get(instance as object, property, receiver);
		return typeof value === "function" ? value.bind(instance) : value;
	},
	has: (_target, property) => Reflect.has(currentAuth() as object, property),
	ownKeys: () => Reflect.ownKeys(currentAuth() as object),
	getOwnPropertyDescriptor: (_target, property) => {
		const descriptor = Reflect.getOwnPropertyDescriptor(currentAuth() as object, property);
		// A proxy may not report a non-configurable property its (empty) target
		// does not have; better-auth's own descriptors are plain data.
		return descriptor ? { ...descriptor, configurable: true } : undefined;
	},
});

/**
 * Rebuild the instance from the providers in the database.
 *
 * Sessions live in Postgres, so nothing signs out. What a rebuild does lose is
 * better-auth's in-memory rate-limit counters — acceptable for something an
 * operator does when they change an IdP, and the reason this is not on a timer.
 */
export async function rebuildAuth(): Promise<void> {
	const providers = await loadSsoProviders();
	globalForAuth.__nixployAuth = buildAuth(providers);
	authLog.info(
		providers.length > 0
			? `Auth rebuilt with ${providers.length} SSO provider(s): ${providers.map((p) => p.providerId).join(", ")}`
			: "Auth rebuilt with no SSO providers",
	);
}

/**
 * Boot: import a pre-0.4 env-configured IdP into a row, then build the real
 * instance. Best-effort — an instance that cannot read its providers still
 * serves password sign-in.
 */
export async function initAuth(): Promise<void> {
	try {
		await seedSsoProvidersFromEnv();
		await rebuildAuth();
	} catch (error) {
		authLog.error("Could not initialise SSO providers", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export type Session = Auth["$Infer"]["Session"];
