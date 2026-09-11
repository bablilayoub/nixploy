import type { TRPCContext } from "../trpc/init";
import type { WsSession } from "../ws/auth";

/**
 * One session shape for the three kinds of caller the panel has, instead of
 * the four incompatible copies the router tests grew (audit F8):
 *
 * - a cookie session (`fakeSession()`),
 * - an API-key session (`fakeSession({ apiKey: true })` — `session.id` carries
 *   the `api-key_` prefix `lib/api-key-context.ts` produces),
 * - an instance admin (`fakeSession({ instanceAdmin: true })` — better-auth's
 *   admin plugin puts `role: "admin"` on the *user* row).
 */

export interface FakeSessionInput {
	userId?: string;
	email?: string;
	/** better-auth user role: `"admin"` marks the instance admin. */
	role?: string | null;
	organizationId?: string | null;
	/** Shortcut for `role: "admin"`. */
	instanceAdmin?: boolean;
	/** Give the session the `api-key_…` id an API-key caller arrives with. */
	apiKey?: boolean | string;
}

export interface FakeSession {
	user: { id: string; email: string; role: string | null };
	session: { id: string; token: string; activeOrganizationId: string | null };
}

export function fakeSession(input: FakeSessionInput = {}): FakeSession {
	const keyId = typeof input.apiKey === "string" ? input.apiKey : "k1";
	return {
		user: {
			id: input.userId ?? "user-1",
			email: input.email ?? "user@example.test",
			role: input.instanceAdmin ? "admin" : (input.role ?? "user"),
		},
		session: {
			id: input.apiKey ? `api-key_${keyId}` : "sess-1",
			token: input.apiKey ? "api-key" : "sess-token",
			activeOrganizationId:
				input.organizationId === undefined ? "org-1" : (input.organizationId ?? null),
		},
	};
}

/** tRPC context for `appRouter.createCaller(...)`. */
export function fakeTRPCContext(input: FakeSessionInput = {}): TRPCContext {
	return {
		headers: new Headers(),
		session: fakeSession(input),
	} as unknown as TRPCContext;
}

/** Websocket session for the `assertWs*Access` gates. */
export function fakeWsSession(input: FakeSessionInput = {}): WsSession {
	return fakeSession(input) as unknown as WsSession;
}
