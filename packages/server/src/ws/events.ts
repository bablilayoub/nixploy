import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { PlatformEvent } from "../modules/deployment";
import { onPlatformEvent, toClientFrame } from "../modules/deployment";
import { ALL_PROJECTS, resolveProjectFilter } from "../modules/projects/project-scope";
import { SERVICE_REGISTRY, type ServiceKind } from "../modules/services/registry";
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

/** True when `event` belongs to `organizationId`. */
export function shouldDeliver(event: PlatformEvent, organizationId: string): boolean {
	return event.organizationId === organizationId;
}

/**
 * The service a frame is about, as `(kind, id)`, or null for a frame that
 * names none (the queue-depth frame is a count, not a service).
 */
export function frameServiceRef(event: PlatformEvent): { kind: ServiceKind; id: string } | null {
	if (event.kind === "deployment") {
		if (event.applicationId) return { kind: "application", id: event.applicationId };
		if (event.composeId) return { kind: "compose", id: event.composeId };
		return null;
	}
	if (event.kind === "service-status") return { kind: event.serviceKind, id: event.id };
	if (event.kind === "service-event") return { kind: event.serviceKind, id: event.serviceId };
	return null;
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

	/**
	 * Team scoping for the push stream.
	 *
	 * A frame carries an appName and a service id, so delivering one for a
	 * project the viewer cannot open would tell them it exists — the one thing
	 * the whole feature is for. The filter is refreshed on the same slow timer
	 * that re-checks the organization, and the service → project lookup is
	 * cached per socket, so a busy deploy costs one query per service rather
	 * than one per frame.
	 */
	let projectFilter = await resolveProjectFilter(session.user.id).catch(() => ALL_PROJECTS);
	const projectByService = new Map<string, string | null>();

	const visible = async (event: PlatformEvent): Promise<boolean> => {
		const ref = frameServiceRef(event);
		// A frame that names no service (queue depth) is a number for the whole
		// organization and gives nothing away.
		if (!ref) return true;
		const cacheKey = `${ref.kind}:${ref.id}`;
		let projectId = projectByService.get(cacheKey);
		if (projectId === undefined) {
			projectId =
				(await SERVICE_REGISTRY[ref.kind].module.findTenancy(ref.id).catch(() => undefined))
					?.projectId ?? null;
			projectByService.set(cacheKey, projectId);
		}
		// A service whose project cannot be resolved (deleted mid-flight) is
		// withheld: the safe direction for a frame nobody can check.
		if (projectId === null) return false;
		return projectFilter.kind === "all" || projectFilter.projectIds.has(projectId);
	};

	const unsubscribe = onPlatformEvent((event) => {
		if (closed) return;
		if (!shouldDeliver(event, organizationId)) return;
		// Unrestricted is the overwhelmingly common case and stays synchronous:
		// a deploy emits a frame per transition, and deferring every one of them
		// to a microtask to ask a question with a constant answer is latency
		// nobody asked for.
		if (projectFilter.kind === "all") {
			sendJson(ws, toClientFrame(event));
			return;
		}
		void visible(event).then((ok) => {
			if (ok && !closed) sendJson(ws, toClientFrame(event));
		});
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
				// Team membership can change under a long-lived socket too.
				projectFilter = await resolveProjectFilter(session.user.id).catch(() => projectFilter);
				projectByService.clear();
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
