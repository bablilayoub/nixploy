import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { apikeys, members, users } from "../../db/schema";
import {
	clearFailures,
	clientIpFromHeaders,
	type LockoutState,
	lockoutStatus,
	recordFailure,
	userAgentFromHeaders,
} from "../../utils/rate-limit";
import { recordAudit } from "../audit";
import { apiKeyMetadataScope, buildApiKeyPermissions } from "./api-key-scopes";

/**
 * Auth events in the audit log, plus the per-account sign-in lockout.
 *
 * Wired into better-auth's `hooks.before` / `hooks.after` in `lib/auth.ts`.
 * `hooks.after` runs for failed requests too (the endpoint's `APIError` lands
 * in `ctx.context.returned`), which is what makes `auth.login.failed`
 * observable at all.
 *
 * Each row is attributed to the actor's oldest membership. `organization_id`
 * is nullable since the audit-completeness work, so an event by a user who
 * belongs to no organization — the window between the first sign-up and org
 * creation, an SSO user with no default org, a failed login for an org-less
 * account — is recorded as an instance-level row instead of being dropped.
 * Client IP and user agent are columns now, not `metadata` keys.
 */

// ── per-account sign-in lockout ─────────────────────────────────────────────

export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const LOGIN_FAILURE_MAX = 10;
export const LOGIN_LOCK_MS = 15 * 60_000;

const loginBucketKey = (email: string): string => `login-failures:${email.trim().toLowerCase()}`;

export function loginLockoutMessage(state: LockoutState): string {
	const minutes = Math.max(1, Math.ceil(state.retryAfterMs / 60_000));
	return `Too many failed sign-in attempts for this account. Try again in ${minutes} minute${
		minutes === 1 ? "" : "s"
	}, or ask an instance admin to reset your password.`;
}

/** Lock state for an email address without recording an attempt. */
export function loginLockoutFor(email: string): LockoutState {
	return lockoutStatus(loginBucketKey(email));
}

/** Count one failed password attempt for `email`. */
export function recordLoginFailure(email: string): LockoutState {
	return recordFailure(loginBucketKey(email), {
		windowMs: LOGIN_FAILURE_WINDOW_MS,
		max: LOGIN_FAILURE_MAX,
		lockMs: LOGIN_LOCK_MS,
	});
}

/** Forget the failure history after a successful sign-in. */
export function clearLoginFailures(email: string): void {
	clearFailures(loginBucketKey(email));
}

// ── audit plumbing ──────────────────────────────────────────────────────────

/** Minimal shape of the better-auth endpoint context the hooks receive. */
export interface AuthHookContext {
	path?: string;
	body?: Record<string, unknown> | null;
	headers?: Headers | null;
	request?: Request | null;
	context?: {
		returned?: unknown;
		session?: { user?: { id?: string; email?: string | null } } | null;
		newSession?: { user?: { id?: string; email?: string | null } } | null;
	};
}

const isApiErrorLike = (value: unknown): boolean =>
	typeof value === "object" &&
	value !== null &&
	("status" in value || "statusCode" in value) &&
	value instanceof Error;

/** True when the endpoint this hook wraps failed. */
export function hookFailed(ctx: AuthHookContext): boolean {
	return isApiErrorLike(ctx.context?.returned);
}

/** Client IP + user agent of the hooked request, as audit columns. */
export function requestContext(ctx: AuthHookContext): { ip: string; userAgent: string | null } {
	const headers = ctx.headers ?? new Headers();
	return {
		// Honours TRUSTED_PROXIES and the socket-peer check, so it is never a
		// forged X-Forwarded-For.
		ip: clientIpFromHeaders(headers),
		userAgent: userAgentFromHeaders(headers),
	};
}

/** `undefined` for an empty metadata object, so the column stays null. */
const metadataOrNull = (metadata: Record<string, unknown>): Record<string, unknown> | undefined =>
	Object.keys(metadata).length > 0 ? metadata : undefined;

/** Oldest membership of a user — the org an auth event is attributed to. */
async function auditOrganizationFor(userId: string): Promise<string | null> {
	const membership = await db.query.members.findFirst({
		where: eq(members.userId, userId),
		orderBy: asc(members.createdAt),
	});
	return membership?.organizationId ?? null;
}

async function actorEmail(userId: string, known?: string | null): Promise<string | null> {
	if (known) return known;
	const row = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { email: true },
	});
	return row?.email ?? null;
}

/**
 * Write one auth audit row.
 *
 * A user with no membership gets `organizationId: null` (an instance-level
 * row) rather than no row at all: impersonation of an org-less account and a
 * failed sign-in before the first organization exists both used to leave no
 * trail (security audit 2.9, auth handoff §3b).
 */
export async function recordAuthEvent(input: {
	userId: string;
	email?: string | null;
	action: string;
	targetType?: string;
	targetId?: string | null;
	targetName?: string | null;
	ip?: string | null;
	userAgent?: string | null;
	metadata?: Record<string, unknown>;
}): Promise<void> {
	await recordAudit({
		organizationId: await auditOrganizationFor(input.userId),
		actorId: input.userId,
		actorEmail: await actorEmail(input.userId, input.email),
		action: input.action,
		targetType: input.targetType ?? "user",
		targetId: input.targetId ?? input.userId,
		targetName: input.targetName ?? null,
		ip: input.ip ?? null,
		userAgent: input.userAgent ?? null,
		metadata: input.metadata ?? null,
	});
}

/**
 * Mirror the scope the panel recorded in `metadata` into the canonical
 * `permissions` column.
 *
 * The api-key plugin refuses `permissions` on any request that carries headers
 * ("server-only property"), so the browser can only send it as metadata. This
 * runs right after a successful `/api-key/create` and writes the column
 * directly, leaving `describeApiKey` with a populated `permissions` for every
 * later verification. Never throws — a failed mirror only means the metadata
 * fallback keeps being used.
 */
async function mirrorApiKeyScope(ctx: AuthHookContext): Promise<void> {
	const created = ctx.context?.returned as
		| { id?: string; metadata?: unknown; permissions?: unknown }
		| undefined;
	if (!created?.id || created.permissions) return;
	const scope = apiKeyMetadataScope(created.metadata);
	if (!scope) return;
	try {
		await db
			.update(apikeys)
			.set({ permissions: JSON.stringify(buildApiKeyPermissions(scope)) })
			.where(and(eq(apikeys.id, created.id), isNull(apikeys.permissions)));
	} catch (error) {
		console.error("Failed to mirror API key scope into permissions:", error);
	}
}

/** Actor of the current request: the new session (sign-in) or the existing one. */
function actorFromContext(ctx: AuthHookContext): { id: string; email?: string | null } | null {
	const fromNew = ctx.context?.newSession?.user;
	if (fromNew?.id) return { id: fromNew.id, email: fromNew.email ?? null };
	const fromSession = ctx.context?.session?.user;
	if (fromSession?.id) return { id: fromSession.id, email: fromSession.email ?? null };
	const returned = ctx.context?.returned as { user?: { id?: string; email?: string } } | undefined;
	if (returned?.user?.id) return { id: returned.user.id, email: returned.user.email ?? null };
	return null;
}

const bodyString = (ctx: AuthHookContext, key: string): string | null => {
	const value = ctx.body?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
};

/** Paths whose success is recorded verbatim as `action`. */
const SIMPLE_EVENTS: Record<string, string> = {
	"/sign-out": "auth.logout",
	"/change-password": "auth.password.changed",
	"/reset-password": "auth.password.changed",
	"/two-factor/enable": "auth.2fa.enabled",
	"/two-factor/disable": "auth.2fa.disabled",
	"/api-key/create": "auth.apikey.created",
	"/api-key/delete": "auth.apikey.deleted",
	"/admin/stop-impersonating": "auth.impersonation.stopped",
};

/** Admin-plugin paths that act on another user, with the action they log. */
const ADMIN_EVENTS: Record<string, string> = {
	"/admin/ban-user": "admin.user.banned",
	"/admin/unban-user": "admin.user.unbanned",
	"/admin/set-role": "admin.user.role.set",
	"/admin/impersonate-user": "auth.impersonation.started",
	"/admin/remove-user": "admin.user.removed",
	"/admin/set-user-password": "admin.user.password.set",
};

/**
 * `hooks.after` body: records the auth event for the finished request.
 * Never throws — an audit failure must not break authentication.
 */
export async function handleAuthEventAfter(ctx: AuthHookContext): Promise<void> {
	try {
		const path = ctx.path ?? "";
		const failed = hookFailed(ctx);
		const request = requestContext(ctx);

		if (path === "/sign-in/email") {
			const email = bodyString(ctx, "email");
			if (failed) {
				if (!email) return;
				const state = recordLoginFailure(email);
				const user = await db.query.users.findFirst({
					where: eq(users.email, email.trim().toLowerCase()),
					columns: { id: true, email: true },
				});
				if (!user) return; // unknown address: nothing to attribute the row to
				await recordAuthEvent({
					userId: user.id,
					email: user.email,
					action: state.locked ? "auth.login.locked" : "auth.login.failed",
					...request,
					metadata: { method: "password" },
				});
				return;
			}
			if (email) clearLoginFailures(email);
			const actor = actorFromContext(ctx);
			if (actor) {
				await recordAuthEvent({
					userId: actor.id,
					email: actor.email,
					action: "auth.login",
					...request,
					metadata: { method: "password" },
				});
			}
			return;
		}

		if (failed) return;

		if (path === "/api-key/create") {
			await mirrorApiKeyScope(ctx);
		}

		if (path.startsWith("/callback/")) {
			const actor = actorFromContext(ctx);
			if (actor) {
				await recordAuthEvent({
					userId: actor.id,
					email: actor.email,
					action: "auth.login",
					...request,
					metadata: { method: "sso" },
				});
			}
			return;
		}

		const adminAction = ADMIN_EVENTS[path];
		if (adminAction) {
			const actor = actorFromContext(ctx);
			if (!actor) return;
			const targetUserId = bodyString(ctx, "userId");
			await recordAuthEvent({
				userId: actor.id,
				email: actor.email,
				action: adminAction,
				targetType: "user",
				targetId: targetUserId ?? actor.id,
				...request,
				metadata: metadataOrNull({
					...(bodyString(ctx, "role") ? { role: bodyString(ctx, "role") } : {}),
					...(bodyString(ctx, "banReason") ? { banReason: bodyString(ctx, "banReason") } : {}),
				}),
			});
			return;
		}

		const simpleAction = SIMPLE_EVENTS[path];
		if (!simpleAction) return;
		const actor = actorFromContext(ctx);
		if (!actor) return;
		await recordAuthEvent({
			userId: actor.id,
			email: actor.email,
			action: simpleAction,
			targetType: path.startsWith("/api-key/") ? "apikey" : "user",
			targetId: path.startsWith("/api-key/") ? (bodyString(ctx, "keyId") ?? actor.id) : actor.id,
			targetName: path === "/api-key/create" ? bodyString(ctx, "name") : null,
			...request,
		});
	} catch (error) {
		console.error("Auth audit hook failed:", error);
	}
}
