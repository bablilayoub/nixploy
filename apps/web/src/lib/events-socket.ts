"use client";

/**
 * One `/ws/events` socket per browser tab.
 *
 * The panel used to learn about a finished deploy by polling
 * `deployment.recent` every 3 s — on every open tab, forever, plus a handful of
 * 15-30 s polls that each shelled out to `docker ps` on the server (architecture
 * audit #14). Now the worker publishes each transition once and this module
 * fans it out to every subscriber in the tab; `hooks/use-live-events.ts` turns a
 * frame into a TanStack Query invalidation and the polls remain only as a
 * fallback while the socket is down.
 *
 * Deliberately a module singleton rather than a React context: the socket must
 * survive route changes and be shared by every consumer, and there is exactly
 * one organization per session (the server re-resolves it and closes the socket
 * when the active organization changes, which this module treats as an ordinary
 * reconnect).
 *
 * Everything here is pure DOM + WebSocket, no React — `subscribe` is what the
 * hook layers on top.
 */

export interface DeploymentFrame {
	kind: "deployment";
	deploymentId: string;
	appName: string | null;
	applicationId: string | null;
	composeId: string | null;
	status: string;
	queuePosition?: number | null;
	isPreview?: boolean;
}

export interface QueueFrame {
	kind: "queue";
	depth: number;
}

export interface ServiceStatusFrame {
	kind: "service-status";
	serviceKind: string;
	id: string;
	status: string;
	appName?: string | null;
}

/** A service's timeline gained rows (`service_event`). */
export interface ServiceEventFrame {
	kind: "service-event";
	serviceKind: string;
	serviceId: string;
	appName: string;
	/** The loudest event kind of the batch that produced this frame. */
	eventKind: string;
	severity: string;
}

export type ControlFrameKind = "ready" | "heartbeat" | "error";

export interface ControlFrame {
	kind: ControlFrameKind;
	at?: string;
	message?: string;
}

const CONTROL_KINDS: ReadonlySet<string> = new Set<ControlFrameKind>([
	"ready",
	"heartbeat",
	"error",
]);

const isControlFrame = (frame: LiveEventFrame): frame is ControlFrame =>
	CONTROL_KINDS.has(frame.kind);

export type LiveEventFrame =
	| DeploymentFrame
	| QueueFrame
	| ServiceStatusFrame
	| ServiceEventFrame
	| ControlFrame;

/** Frames a consumer acts on (the control frames are handled in here). */
export type LiveEvent = DeploymentFrame | QueueFrame | ServiceStatusFrame | ServiceEventFrame;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/**
 * Parse one socket message. Returns `null` for anything unrecognised — a newer
 * server sending a frame kind this build does not know must be ignored, not
 * throw inside `onmessage` (which would kill the handler for every consumer).
 */
export function parseEventFrame(data: string): LiveEventFrame | null {
	let raw: unknown;
	try {
		raw = JSON.parse(data);
	} catch {
		return null;
	}
	if (!isRecord(raw)) return null;
	switch (raw.kind) {
		case "deployment":
			if (typeof raw.deploymentId !== "string" || typeof raw.status !== "string") return null;
			return {
				kind: "deployment",
				deploymentId: raw.deploymentId,
				appName: typeof raw.appName === "string" ? raw.appName : null,
				applicationId: typeof raw.applicationId === "string" ? raw.applicationId : null,
				composeId: typeof raw.composeId === "string" ? raw.composeId : null,
				status: raw.status,
				queuePosition: typeof raw.queuePosition === "number" ? raw.queuePosition : null,
				isPreview: raw.isPreview === true,
			};
		case "queue":
			if (typeof raw.depth !== "number") return null;
			return { kind: "queue", depth: raw.depth };
		case "service-event":
			if (typeof raw.serviceKind !== "string" || typeof raw.serviceId !== "string") return null;
			return {
				kind: "service-event",
				serviceKind: raw.serviceKind,
				serviceId: raw.serviceId,
				appName: typeof raw.appName === "string" ? raw.appName : "",
				eventKind: typeof raw.eventKind === "string" ? raw.eventKind : "",
				severity: typeof raw.severity === "string" ? raw.severity : "info",
			};
		case "service-status":
			if (
				typeof raw.serviceKind !== "string" ||
				typeof raw.id !== "string" ||
				typeof raw.status !== "string"
			) {
				return null;
			}
			return {
				kind: "service-status",
				serviceKind: raw.serviceKind,
				id: raw.id,
				status: raw.status,
				appName: typeof raw.appName === "string" ? raw.appName : null,
			};
		case "ready":
		case "heartbeat":
		case "error":
			return {
				kind: raw.kind,
				at: typeof raw.at === "string" ? raw.at : undefined,
				message: typeof raw.message === "string" ? raw.message : undefined,
			};
		default:
			return null;
	}
}

/** First retry delay; doubles per attempt. */
export const BASE_BACKOFF_MS = 1_000;
/** Ceiling — a panel that is down for an hour must not reconnect once an hour. */
export const MAX_BACKOFF_MS = 30_000;

/**
 * Reconnect delay for attempt `attempt` (1-based), with ±20 % jitter so a
 * panel restart does not bring every open tab back in the same millisecond.
 * `random` is injectable for tests.
 */
export function nextBackoffMs(attempt: number, random: () => number = Math.random): number {
	const exponential = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
	const jitter = 1 + (random() - 0.5) * 0.4;
	return Math.round(exponential * jitter);
}

type EventListener = (event: LiveEvent) => void;
type ConnectionListener = (connected: boolean) => void;

const eventListeners = new Set<EventListener>();
const connectionListeners = new Set<ConnectionListener>();

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let connected = false;
let browserHooksAttached = false;

/** Grace before the socket is torn down after the last consumer left (route changes remount). */
const IDLE_CLOSE_MS = 5_000;

function eventsUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/ws/events`;
}

function setConnected(next: boolean): void {
	if (connected === next) return;
	connected = next;
	for (const listener of [...connectionListeners]) listener(next);
}

function scheduleReconnect(): void {
	if (reconnectTimer || eventListeners.size === 0) return;
	attempts += 1;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		open();
	}, nextBackoffMs(attempts));
}

function open(): void {
	if (typeof window === "undefined") return;
	if (
		socket &&
		(socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
	) {
		return;
	}
	let ws: WebSocket;
	try {
		ws = new WebSocket(eventsUrl());
	} catch {
		scheduleReconnect();
		return;
	}
	socket = ws;

	ws.onopen = () => {
		attempts = 0;
		setConnected(true);
	};

	ws.onmessage = (message: MessageEvent<string>) => {
		const frame = parseEventFrame(typeof message.data === "string" ? message.data : "");
		if (!frame) return;
		// `ready` / `heartbeat` only prove the socket is alive; nothing to fan out.
		if (isControlFrame(frame)) return;
		for (const listener of [...eventListeners]) {
			try {
				listener(frame);
			} catch {
				// One bad consumer must not stop the others.
			}
		}
	};

	const onDown = () => {
		if (socket === ws) socket = null;
		setConnected(false);
		scheduleReconnect();
	};
	ws.onclose = onDown;
	ws.onerror = onDown;
}

function attachBrowserHooks(): void {
	if (browserHooksAttached || typeof window === "undefined") return;
	browserHooksAttached = true;
	// Coming back from a sleeping laptop or a lost network: retry now instead of
	// waiting out the backoff the tab accumulated while it was hidden.
	const wake = () => {
		if (eventListeners.size === 0 || connected) return;
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		attempts = 0;
		open();
	};
	window.addEventListener("online", wake);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") wake();
	});
}

/**
 * Receive live events. The socket opens on the first subscriber and closes a
 * few seconds after the last one leaves (so a route change does not churn it).
 * Returns an unsubscribe function.
 */
export function subscribeToLiveEvents(listener: EventListener): () => void {
	eventListeners.add(listener);
	if (closeTimer) {
		clearTimeout(closeTimer);
		closeTimer = null;
	}
	attachBrowserHooks();
	open();
	return () => {
		eventListeners.delete(listener);
		if (eventListeners.size > 0 || closeTimer) return;
		closeTimer = setTimeout(() => {
			closeTimer = null;
			if (eventListeners.size > 0) return;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			const ws = socket;
			socket = null;
			setConnected(false);
			ws?.close(1000, "No subscribers");
		}, IDLE_CLOSE_MS);
	};
}

/** Watch the connection flag (drives the "fall back to polling" decision). */
export function subscribeToLiveEventsConnection(listener: ConnectionListener): () => void {
	connectionListeners.add(listener);
	return () => {
		connectionListeners.delete(listener);
	};
}

/** Current connection flag (also the `getSnapshot` for `useSyncExternalStore`). */
export function isLiveEventsConnected(): boolean {
	return connected;
}
