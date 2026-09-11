import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { PlatformEvent } from "../modules/deployment";
import { onPlatformEvent, toClientFrame } from "../modules/deployment";
import { resolveWsOrganizationId } from "./access";
import type { WsSession } from "./auth";
import { closeWithError, sendJson } from "./utils";

/**
 * /ws/events — one authenticated push stream per browser tab.
 *
 * This is the "push instead of poll" half of architecture audit #14: the
 * dashboard used to keep a 3 s `deployment.recent` poll alive (plus a handful
 * of 15-30 s docker polls) on every open tab, forever. Now the worker
 * publishes each transition once (`modules/deployment/notify.ts`) and this
 * socket fans it out; TanStack Query turns a frame into an invalidation
 * (`apps/web/src/hooks/use-live-events.ts`). The polls stay only as a fallback
 * for a disconnected socket.
 *
 * Frames (see `ClientFrame`):
 *   { kind: "deployment", deploymentId, appName, applicationId, composeId, status, queuePosition? }
 *   { kind: "queue", depth }
 *   { kind: "service-status", serviceKind, id, status, appName? }
 *   { kind: "ready" }                      once, right after the org resolved
 *   { kind: "heartbeat", at }              every 30 s, so a dead proxy is visible
 *
 * Tenancy: the organization is resolved ONCE at connect with the same rules as
 * a `protectedProcedure` (`resolveWsOrganizationId`, 2FA gate included), and
 * every event is matched against it before it is sent. The tenant id is
 * carried on the server-side event and stripped by {@link toClientFrame} — a
 * client never learns another org exists. The org is re-resolved on a slow
 * timer so switching the active organization tears the socket down instead of
 * leaving it subscribed to the previous tenant.
 */

/** How often a heartbeat frame is sent (also proves the socket is still writable). */
const HEARTBEAT_MS = 30_000;

/** How often the caller's organization is re-resolved (org switch, membership change). */
const REAUTH_MS = 60_000;

/** True when `event` belongs to `organizationId` — the only delivery rule. */
export function shouldDeliver(event: PlatformEvent, organizationId: string): boolean {
	return event.organizationId === organizationId;
}

export async function handlePlatformEvents(
	ws: WebSocket,
	_req: IncomingMessage,
	session: WsSession,
): Promise<void> {
	let organizationId: string;
	try {
		organizationId = await resolveWsOrganizationId(session);
	} catch (error) {
		closeWithError(ws, error instanceof Error ? error.message : "Not authorized");
		return;
	}

	let closed = false;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let reauth: ReturnType<typeof setInterval> | null = null;

	const cleanup = () => {
		if (closed) return;
		closed = true;
		if (heartbeat) clearInterval(heartbeat);
		if (reauth) clearInterval(reauth);
		heartbeat = null;
		reauth = null;
		unsubscribe();
	};

	const unsubscribe = onPlatformEvent((event) => {
		if (closed) return;
		if (!shouldDeliver(event, organizationId)) return;
		sendJson(ws, toClientFrame(event));
	});

	ws.on("close", cleanup);
	ws.on("error", cleanup);

	sendJson(ws, { kind: "ready" });

	heartbeat = setInterval(() => {
		if (closed) return;
		sendJson(ws, { kind: "heartbeat", at: new Date().toISOString() });
	}, HEARTBEAT_MS);
	heartbeat.unref?.();

	reauth = setInterval(() => {
		void (async () => {
			if (closed) return;
			try {
				const current = await resolveWsOrganizationId(session);
				if (current === organizationId) return;
				// The caller switched organizations (or lost access to this one):
				// drop the socket and let the client reconnect into the new scope
				// rather than silently keeping the old subscription.
				cleanup();
				ws.close(1000, "Organization changed");
			} catch {
				cleanup();
				ws.close(1008, "Not authorized");
			}
		})();
	}, REAUTH_MS);
	reauth.unref?.();
}
