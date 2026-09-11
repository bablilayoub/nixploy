import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { apikeys, members, users } from "../../db/schema";
import {
	clearFailures,
	clientIpFromRequest,
	type LockoutState,
	lockoutStatus,
	recordFailure,
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
 * The audit table requires an `organization_id`, so each row is attributed to
 * the actor's oldest membership; events by users who belong to no organization
 * (the moment between first sign-up and org creation) are dropped. Client IP
 * and user agent go into `metadata` — the table has no columns for them.
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

function requestFor(ctx: AuthHookContext): Request {
	return new Request("http://local", { headers: ctx.headers ?? new Headers() });
}

/** IP + user agent for the metadata blob (the audit table has no columns). */
export function requestMetadata(ctx: AuthHookContext): Record<string, unknown> {
	const headers = ctx.headers ?? new Headers();
	return {
		ip: clientIpFromRequest(requestFor(ctx)),
		userAgent: headers.get("user-agent") ?? null,
	};
}

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

/** Write one auth audit row; silently skipped when the actor has no org. */
export async function recordAuthEvent(input: {
	userId: string;
	email?: string | null;
	action: string;
	targetType?: string;
	targetId?: string | null;
	targetName?: string | null;
	metadata?: Record<string, unknown>;
}): Promise<void> {
	const organizationId = await auditOrganizationFor(input.userId);
	if (!organizationId) return;
	await recordAudit({
		organizationId,
		actorId: input.userId,
		actorEmail: await actorEmail(input.userId, input.email),
		action: input.action,
		targetType: input.targetType ?? "user",
		targetId: input.targetId ?? input.userId,
		targetName: input.targetName ?? null,
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
		const metadata = requestMetadata(ctx);

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
					metadata: { ...metadata, method: "password" },
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
					metadata: { ...metadata, method: "password" },
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
					metadata: { ...metadata, method: "sso" },
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
				metadata: {
					...metadata,
					...(bodyString(ctx, "role") ? { role: bodyString(ctx, "role") } : {}),
					...(bodyString(ctx, "banReason") ? { banReason: bodyString(ctx, "banReason") } : {}),
				},
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
			metadata,
		});
	} catch (error) {
		console.error("Auth audit hook failed:", error);
	}
}
