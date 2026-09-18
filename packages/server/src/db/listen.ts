import postgres from "postgres";

/**
 * Postgres `LISTEN/NOTIFY` transport.
 *
 * The panel and the worker are two processes once `NIXPLOY_ROLE` is split
 * (`lib/role.ts`), so the in-process `deploymentEvents` emitter can no longer
 * carry "a job was queued", "cancel this build" or "this deployment finished".
 * Postgres is already the queue's source of truth and both processes are
 * connected to it, so it is also the cheapest event bus we can have: no broker,
 * no schema change, no migration — `NOTIFY` is sent from application code
 * **after** the transaction that made the fact true, never from a trigger.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **A listener needs its own connection.** A session that has issued
 *    `LISTEN` cannot be handed back to the pool, so this opens a dedicated
 *    `max: 1` client instead of borrowing from `db/index.ts`'s pool (whose max
 *    is 3 in dev). postgres.js reconnects it on its own and re-issues the
 *    `LISTEN` — the `onlisten` callback fires again after a reconnect, which is
 *    exactly when a subscriber has to re-read anything it may have missed.
 * 2. **Payloads are small.** Postgres caps a notification payload at 8000
 *    bytes. Everything published here is a short JSON status frame; deployment
 *    LOG chunks deliberately do NOT travel this way (the log file on the shared
 *    config volume stays the source of truth — see `ws/deployment-logs.ts`).
 *
 * The client lives on `globalThis` for the same reason the deploy queue and
 * `deploymentEvents` do: Next's `transpilePackages` evaluates this module twice
 * (route chunks vs. `server.ts`), and two listener connections per channel
 * would double every event.
 */

type SqlClient = postgres.Sql;

const globalForListen = globalThis as typeof globalThis & {
	__nixployListenSql?: SqlClient;
};

/** Notification channels. Namespaced so they never collide with a tenant's own. */
export const CHANNELS = {
	/** A `queued` row was inserted — wake the worker's claim loop. */
	deployQueued: "nixploy_deploy_queued",
	/** The panel asks the worker to kill a build it is running. */
	deployCancel: "nixploy_deploy_cancel",
	/** Deployment/service/queue status frames for `/ws/events`. */
	events: "nixploy_events",
	/**
	 * An SSO provider changed — every process must rebuild its better-auth
	 * instance, because the plugin array is frozen at construction.
	 */
	authRebuild: "nixploy_auth_rebuild",
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** Largest payload Postgres accepts on a NOTIFY (bytes). */
export const MAX_NOTIFY_PAYLOAD_BYTES = 8000;

function getDatabaseUrl(): string {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is not set — LISTEN/NOTIFY is unavailable");
	}
	return databaseUrl;
}

/**
 * The dedicated listener client. Created on first use so importing this module
 * never opens a connection (offline unit tests and `next build` must keep
 * working without a database).
 */
function listenClient(): SqlClient {
	if (!globalForListen.__nixployListenSql) {
		globalForListen.__nixployListenSql = postgres(getDatabaseUrl(), {
			max: 1,
			prepare: false,
			// A listener connection is idle by definition: never let the pool
			// reap it, or notifications stop arriving silently.
			idle_timeout: 0,
			max_lifetime: 0,
			onnotice: () => {},
		});
	}
	return globalForListen.__nixployListenSql;
}

export interface Subscription {
	/** Stop listening and release the channel. */
	unsubscribe: () => Promise<void>;
}

/**
 * Subscribe to `channel`. `onPayload` receives the raw NOTIFY payload (a JSON
 * string for every channel this codebase uses). `onReconnect` fires after the
 * connection came back and the `LISTEN` was re-issued — a subscriber that
 * cannot afford a missed message re-reads its source of truth there (the claim
 * loop simply pokes itself).
 *
 * Errors are reported through `onError` instead of throwing: a bus that is
 * down must degrade to the slow poll, never take the process with it.
 */
export async function subscribe(
	channel: Channel,
	onPayload: (payload: string) => void,
	options: { onReconnect?: () => void; onError?: (error: unknown) => void } = {},
): Promise<Subscription> {
	let listened = false;
	const handle = await listenClient().listen(
		channel,
		(payload) => {
			try {
				onPayload(payload);
			} catch (error) {
				options.onError?.(error);
			}
		},
		() => {
			// Fires on the first LISTEN and on every reconnect after it.
			if (listened) options.onReconnect?.();
			listened = true;
		},
	);
	return {
		unsubscribe: async () => {
			await handle.unlisten().catch(() => {});
		},
	};
}

/**
 * Send a notification. Uses the shared pool (`db/index.ts`) — NOTIFY is an
 * ordinary statement and must not tie up the listener connection.
 *
 * Oversized payloads are refused here rather than by Postgres so the caller
 * gets a clear error instead of a mid-transaction failure; nothing in this
 * codebase comes close to the cap.
 */
export async function notify(channel: Channel, payload: string): Promise<void> {
	if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFY_PAYLOAD_BYTES) {
		throw new Error(
			`NOTIFY payload for ${channel} exceeds ${MAX_NOTIFY_PAYLOAD_BYTES} bytes — send a reference, not the data`,
		);
	}
	const { client } = await import("./index");
	await client.notify(channel, payload);
}

/** Close the listener connection (graceful shutdown, tests). */
export async function closeListener(): Promise<void> {
	const sql = globalForListen.__nixployListenSql;
	if (!sql) return;
	globalForListen.__nixployListenSql = undefined;
	await sql.end({ timeout: 5 }).catch(() => {});
}
