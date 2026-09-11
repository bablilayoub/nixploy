import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import { db } from "../db";
import { servers } from "../db/schema";
import { createLogger } from "../lib/logger";
import { getSshKeysPath } from "../modules/deployment/paths";
import { notFound, preconditionFailed } from "../modules/errors";

/**
 * Per-server SSH transport: one pooled ssh2 `Client` per managed server, a
 * bounded number of concurrent channels on it, keepalive, idle close, and a
 * circuit breaker (architecture audit #7, §4.4).
 *
 * Before this, every remote command, every dockerode call and every WS log or
 * stats stream opened its own TCP connection and its own key exchange — ten
 * servers meant hundreds of handshakes a minute from the crons and the UI
 * alone, and an unreachable host cost 30 s of `readyTimeout` on *every*
 * attempt.
 *
 * Everything that talks SSH goes through {@link acquireSsh}: it hands out a
 * lease on one channel of the shared connection and the caller releases it
 * when its exec channel closes. Nothing else in the codebase may construct an
 * ssh2 `Client` for a managed server.
 *
 * The pool is process-wide state, so it lives on `globalThis`: Next's
 * `transpilePackages` evaluates `packages/server` twice (route chunks and the
 * tsx-loaded `server.ts`), and two pools would mean two connections per server
 * and two independent breakers (same reason as `deployment/events.ts`).
 */

const log = createLogger("ssh-pool");

/* -------------------------------------------------------------------------- */
/*  Host-key pinning                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Directory holding the TOFU host-key pins of managed servers:
 * `<configDir>/ssh/pinned-hosts/<serverId>.pub`.
 *
 * Earlier releases wrote them under `<configDir>/ssh/known_hosts/`, which
 * collided with the OpenSSH `UserKnownHostsFile` git clones need (that path
 * must be a file, not a directory). The old location is still read as a
 * fallback so existing pins keep working after an upgrade.
 *
 * Lives here rather than in `utils/exec.ts` so the pool has no import cycle
 * with it; `utils/exec.ts` re-exports these under their original names.
 */
export const getPinnedHostsDir = (): string => path.join(getSshKeysPath(), "pinned-hosts");

const legacyPinnedHostFile = (serverId: string): string =>
	path.join(getSshKeysPath(), "known_hosts", `${serverId}.pub`);

/**
 * Trust-on-first-use host key pinning for managed servers.
 * Keys live under `<configDir>/ssh/pinned-hosts/<serverId>.pub`.
 */
export function verifyRemoteHostKey(serverId: string, key: Buffer): boolean {
	const dir = getPinnedHostsDir();
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${serverId}.pub`);
	const encoded = key.toString("base64");
	if (existsSync(file)) {
		return readFileSync(file, "utf8").trim() === encoded;
	}
	// Pre-rename installs: honor (and migrate) the legacy pin.
	const legacy = legacyPinnedHostFile(serverId);
	if (existsSync(legacy)) {
		const pinned = readFileSync(legacy, "utf8").trim();
		if (pinned !== encoded) return false;
		writeFileSync(file, `${pinned}\n`, { mode: 0o600 });
		return true;
	}
	writeFileSync(file, `${encoded}\n`, { mode: 0o600 });
	return true;
}

/** Clear a pinned host key (e.g. after intentional server rebuild). */
export function clearRemoteHostKey(serverId: string): void {
	for (const file of [
		path.join(getPinnedHostsDir(), `${serverId}.pub`),
		legacyPinnedHostFile(serverId),
	]) {
		try {
			unlinkSync(file);
		} catch {
			// missing is fine
		}
	}
}

/* -------------------------------------------------------------------------- */
/*  Knobs                                                                     */
/* -------------------------------------------------------------------------- */

/** OpenSSH's `MaxSessions` defaults to 10 — stay under it with headroom. */
export const DEFAULT_SSH_MAX_CHANNELS = 8;
export const DEFAULT_SSH_IDLE_MS = 5 * 60_000;
export const DEFAULT_SSH_BREAKER_MS = 5 * 60_000;
export const DEFAULT_SSH_BREAKER_FAILURES = 3;
/** Was `readyTimeout` on every ad-hoc connection; now the pool's dial budget. */
export const DEFAULT_SSH_CONNECT_TIMEOUT_MS = 30_000;

/** Keepalive: probe every 15 s, give up after 3 unanswered probes (~45 s). */
const KEEPALIVE_INTERVAL_MS = 15_000;
const KEEPALIVE_COUNT_MAX = 3;

/** Floor for the millisecond knobs — anything lower is a typo, not a setting. */
const MIN_INTERVAL_MS = 10;

function intFromEnv(name: string, fallback: number, min: number): number {
	const raw = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(raw) && raw >= min ? raw : fallback;
}

export interface SshPoolLimits {
	maxChannels: number;
	idleMs: number;
	breakerMs: number;
	breakerFailures: number;
	connectTimeoutMs: number;
}

/** Read the pool knobs from the environment (re-read per call, so tests can flip them). */
export function sshPoolLimits(): SshPoolLimits {
	return {
		maxChannels: intFromEnv("NIXPLOY_SSH_MAX_CHANNELS", DEFAULT_SSH_MAX_CHANNELS, 1),
		idleMs: intFromEnv("NIXPLOY_SSH_IDLE_MS", DEFAULT_SSH_IDLE_MS, MIN_INTERVAL_MS),
		breakerMs: intFromEnv("NIXPLOY_SSH_BREAKER_MS", DEFAULT_SSH_BREAKER_MS, MIN_INTERVAL_MS),
		breakerFailures: intFromEnv("NIXPLOY_SSH_BREAKER_FAILURES", DEFAULT_SSH_BREAKER_FAILURES, 1),
		connectTimeoutMs: intFromEnv(
			"NIXPLOY_SSH_CONNECT_TIMEOUT_MS",
			DEFAULT_SSH_CONNECT_TIMEOUT_MS,
			MIN_INTERVAL_MS,
		),
	};
}

/** "45s" / "4m 58s" — used in the breaker's user-facing message. */
function describeDuration(ms: number): string {
	const seconds = Math.max(1, Math.ceil(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/* -------------------------------------------------------------------------- */
/*  Credentials                                                               */
/* -------------------------------------------------------------------------- */

/** Connection identity of a managed server — never carries the private key. */
export interface PooledServer {
	serverId: string;
	name: string;
	host: string;
	port: number;
	username: string;
}

interface Credentials extends PooledServer {
	/** Decrypted at rest by `encryptedText`. Never logged, never in an error. */
	privateKey: string;
}

async function loadCredentials(serverId: string): Promise<Credentials> {
	const server = await db.query.servers.findFirst({
		where: eq(servers.serverId, serverId),
		with: { sshKey: true },
	});
	if (!server) throw notFound(`Server not found: ${serverId}`);
	const sshKey = server.sshKey;
	if (!sshKey) {
		throw preconditionFailed(`Server ${server.name} (${serverId}) has no SSH key attached`);
	}
	return {
		serverId,
		name: server.name,
		host: server.ipAddress,
		port: server.port,
		username: server.username,
		privateKey: sshKey.privateKey,
	};
}

/* -------------------------------------------------------------------------- */
/*  Pool state                                                                */
/* -------------------------------------------------------------------------- */

interface BreakerState {
	/** Consecutive *connection* failures; a non-zero command exit is not one. */
	failures: number;
	/** Epoch ms until which new commands are refused, or null when closed. */
	openUntil: number | null;
	lastError: string | null;
	lastSeenAt: number | null;
}

interface Waiter {
	grant: () => void;
	fail: (error: Error) => void;
}

interface ServerEntry {
	serverId: string;
	credentials: Credentials | null;
	client: Client | null;
	server: PooledServer | null;
	connecting: Promise<Connected> | null;
	/** Reserved channel slots (handed out leases + granted waiters). */
	channels: number;
	waiters: Waiter[];
	idleTimer: NodeJS.Timeout | null;
	breaker: BreakerState;
	leases: Set<LeaseImpl>;
	/** Bumped on every dial/teardown so stale socket handlers become no-ops. */
	generation: number;
}

interface Connected {
	client: Client;
	server: PooledServer;
}

const globalForSsh = globalThis as typeof globalThis & {
	__nixploySshPool?: Map<string, ServerEntry>;
};

if (!globalForSsh.__nixploySshPool) {
	globalForSsh.__nixploySshPool = new Map<string, ServerEntry>();
}
const pool: Map<string, ServerEntry> = globalForSsh.__nixploySshPool;

function getEntry(serverId: string): ServerEntry {
	const existing = pool.get(serverId);
	if (existing) return existing;
	const entry: ServerEntry = {
		serverId,
		credentials: null,
		client: null,
		server: null,
		connecting: null,
		channels: 0,
		waiters: [],
		idleTimer: null,
		breaker: { failures: 0, openUntil: null, lastError: null, lastSeenAt: null },
		leases: new Set(),
		generation: 0,
	};
	pool.set(serverId, entry);
	return entry;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------------------------- */
/*  Circuit breaker                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Refuse a command while the breaker is open. Once `openUntil` has passed the
 * breaker goes half-open: exactly the next dial is allowed through, and it
 * either closes the breaker (success) or re-opens it (failure). The message
 * deliberately carries no stderr and no address — operators get those from
 * {@link getServerTransportState}, which is gated on `servers.manage`.
 */
function assertBreakerClosed(entry: ServerEntry): void {
	const { breaker } = entry;
	if (breaker.openUntil === null) return;
	const remaining = breaker.openUntil - Date.now();
	if (remaining <= 0) {
		breaker.openUntil = null;
		return;
	}
	const name = entry.credentials?.name ?? entry.serverId;
	throw preconditionFailed(
		`Server "${name}" is unreachable over SSH: ${breaker.failures} connection attempts failed. Nixploy retries in ${describeDuration(remaining)}.`,
	);
}

function recordFailure(entry: ServerEntry, error: unknown): void {
	const limits = sshPoolLimits();
	const { breaker } = entry;
	breaker.failures += 1;
	breaker.lastError = errorMessage(error);
	if (breaker.failures >= limits.breakerFailures && breaker.openUntil === null) {
		breaker.openUntil = Date.now() + limits.breakerMs;
		log.warn("SSH circuit breaker opened", {
			serverId: entry.serverId,
			failures: breaker.failures,
			retryAfterMs: limits.breakerMs,
		});
	}
}

function recordSuccess(entry: ServerEntry): void {
	const { breaker } = entry;
	const recovering = breaker.failures > 0 || breaker.openUntil !== null;
	breaker.failures = 0;
	breaker.openUntil = null;
	breaker.lastError = null;
	breaker.lastSeenAt = Date.now();
	if (recovering) log.info("SSH transport recovered", { serverId: entry.serverId });
}

/** What the UI (and the handoff) needs to render "unreachable" for a server. */
export interface ServerTransportState {
	serverId: string;
	/** `unreachable` exactly while the breaker is open. */
	status: "ok" | "unreachable";
	/** Live pooled connection right now. */
	connected: boolean;
	/** Channels currently reserved on the pooled connection. */
	openChannels: number;
	consecutiveFailures: number;
	/** Epoch ms when Nixploy will try again, null when the breaker is closed. */
	retryAt: number | null;
	/** Last transport error message (operators only — may name the host). */
	lastError: string | null;
	/** Epoch ms of the last command that reached the server. */
	lastSeenAt: number | null;
}

export function getServerTransportState(serverId: string): ServerTransportState {
	const entry = pool.get(serverId);
	if (!entry) {
		return {
			serverId,
			status: "ok",
			connected: false,
			openChannels: 0,
			consecutiveFailures: 0,
			retryAt: null,
			lastError: null,
			lastSeenAt: null,
		};
	}
	const open = entry.breaker.openUntil !== null && entry.breaker.openUntil > Date.now();
	return {
		serverId,
		status: open ? "unreachable" : "ok",
		connected: entry.client !== null,
		openChannels: entry.channels,
		consecutiveFailures: entry.breaker.failures,
		retryAt: open ? entry.breaker.openUntil : null,
		lastError: entry.breaker.lastError,
		lastSeenAt: entry.breaker.lastSeenAt,
	};
}

/** True while the breaker is open — fan-out crons skip these servers entirely. */
export function isServerUnreachable(serverId: string): boolean {
	return getServerTransportState(serverId).status === "unreachable";
}

/**
 * Close the breaker and force the next command to dial fresh. Called by
 * `server.testConnection` / `server.setup`: an operator asking "is it back?"
 * must not be answered from a stale breaker.
 */
export function resetServerTransport(serverId: string): void {
	const entry = pool.get(serverId);
	if (!entry) return;
	entry.breaker.failures = 0;
	entry.breaker.openUntil = null;
	entry.breaker.lastError = null;
	entry.credentials = null;
	dropConnection(entry, null);
}

/**
 * Forget everything cached about a server (credentials and the live
 * connection) without touching the breaker. Called when the row changes: a
 * swapped IP, port, user or SSH key must not keep talking to the old host.
 */
export function invalidateServerTransport(serverId: string): void {
	const entry = pool.get(serverId);
	if (!entry) return;
	entry.credentials = null;
	dropConnection(entry, null);
}

/** Tear every pooled connection down (graceful shutdown, tests). */
export function closeAllSshConnections(): void {
	for (const entry of pool.values()) {
		clearIdleTimer(entry);
		const waiters = entry.waiters;
		entry.waiters = [];
		for (const waiter of waiters) waiter.fail(new Error("SSH pool is shutting down"));
		dropConnection(entry, null);
	}
	pool.clear();
}

/* -------------------------------------------------------------------------- */
/*  Channel slots                                                             */
/* -------------------------------------------------------------------------- */

function clearIdleTimer(entry: ServerEntry): void {
	if (!entry.idleTimer) return;
	clearTimeout(entry.idleTimer);
	entry.idleTimer = null;
}

function armIdleTimer(entry: ServerEntry): void {
	clearIdleTimer(entry);
	if (!entry.client) return;
	entry.idleTimer = setTimeout(() => {
		entry.idleTimer = null;
		if (entry.channels > 0 || !entry.client) return;
		log.debug("Closing idle SSH connection", { serverId: entry.serverId });
		dropConnection(entry, null);
	}, sshPoolLimits().idleMs);
	entry.idleTimer.unref?.();
}

function reserveSlot(entry: ServerEntry): Promise<void> {
	const max = sshPoolLimits().maxChannels;
	if (entry.channels < max) {
		entry.channels += 1;
		clearIdleTimer(entry);
		return Promise.resolve();
	}
	// Every channel is busy: queue FIFO instead of opening a second connection
	// (ssh2 servers cap concurrent sessions, and a second handshake is exactly
	// what the pool exists to avoid).
	return new Promise<void>((resolve, reject) => {
		entry.waiters.push({
			grant: () => {
				entry.channels += 1;
				clearIdleTimer(entry);
				resolve();
			},
			fail: reject,
		});
	});
}

function releaseSlot(entry: ServerEntry): void {
	entry.channels = Math.max(0, entry.channels - 1);
	const next = entry.waiters.shift();
	if (next) {
		next.grant();
		return;
	}
	if (entry.channels === 0) armIdleTimer(entry);
}

/* -------------------------------------------------------------------------- */
/*  Connection lifecycle                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Drop the pooled connection. `error` non-null means the transport failed
 * (counts toward the breaker); null means we closed it on purpose (idle,
 * row change, shutdown). Leases held on it are notified and their slots
 * released — the caller's promise rejects through its own stream handler.
 */
function dropConnection(entry: ServerEntry, error: Error | null): void {
	const client = entry.client;
	entry.generation += 1;
	entry.client = null;
	entry.server = null;
	entry.connecting = null;
	if (error) recordFailure(entry, error);
	const leases = [...entry.leases];
	entry.leases.clear();
	for (const lease of leases) {
		lease.connectionLost(error ?? new Error("SSH connection closed"));
	}
	if (!client) return;
	try {
		client.destroy();
	} catch {
		// already gone
	}
}

async function dial(entry: ServerEntry): Promise<Connected> {
	const startGeneration = entry.generation;
	const credentials = entry.credentials ?? (await loadCredentials(entry.serverId));
	entry.credentials = credentials;
	// Re-check after the (awaited) row read: the breaker may have opened while
	// this dial was queued behind the DB.
	assertBreakerClosed(entry);

	const { privateKey, ...server } = credentials;
	const limits = sshPoolLimits();
	const { serverId } = entry;
	const client = new Client();

	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			const onReady = () => {
				if (settled) return;
				settled = true;
				client.removeListener("error", onError);
				resolve();
			};
			const onError = (error: Error) => {
				if (settled) return;
				settled = true;
				client.removeListener("ready", onReady);
				reject(error);
			};
			client.once("ready", onReady);
			client.once("error", onError);
			client.connect({
				host: server.host,
				port: server.port,
				username: server.username,
				privateKey,
				readyTimeout: limits.connectTimeoutMs,
				keepaliveInterval: KEEPALIVE_INTERVAL_MS,
				keepaliveCountMax: KEEPALIVE_COUNT_MAX,
				hostVerifier: (key: Buffer) => verifyRemoteHostKey(serverId, key),
			});
		});
	} catch (error) {
		try {
			client.end();
		} catch {
			// never connected
		}
		recordFailure(entry, error);
		throw error;
	}

	if (entry.generation !== startGeneration) {
		// The row changed (or the pool was torn down) mid-handshake: this socket
		// may point at the old host, so it must never enter the pool.
		try {
			client.end();
		} catch {
			// already gone
		}
		throw new Error("SSH connection was invalidated while connecting");
	}

	const generation = ++entry.generation;
	entry.client = client;
	entry.server = server;
	recordSuccess(entry);
	log.debug("SSH connection established", { serverId, channelLimit: limits.maxChannels });

	// A keepalive timeout, a reset or a remote `sshd` restart lands here: drop
	// the connection so the next command reconnects instead of hanging on a
	// dead socket.
	client.on("error", (error: Error) => {
		if (entry.generation !== generation) return;
		dropConnection(entry, error);
	});
	client.on("close", () => {
		if (entry.generation !== generation) return;
		dropConnection(entry, null);
	});
	return { client, server };
}

function connect(entry: ServerEntry): Promise<Connected> {
	if (entry.client && entry.server) {
		return Promise.resolve({ client: entry.client, server: entry.server });
	}
	if (entry.connecting) return entry.connecting;
	assertBreakerClosed(entry);
	const attempt = dial(entry).then(
		(connected) => {
			if (entry.connecting === attempt) entry.connecting = null;
			return connected;
		},
		(error) => {
			if (entry.connecting === attempt) entry.connecting = null;
			throw error;
		},
	);
	entry.connecting = attempt;
	return attempt;
}

/* -------------------------------------------------------------------------- */
/*  Leases                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A reservation for exactly one channel on a server's pooled connection.
 * Open one exec/shell channel on `client`, then {@link SshLease.release} when
 * it closes. Holding a lease without opening a channel starves other callers.
 */
export interface SshLease {
	/** The shared ssh2 client. Never call `end()`/`destroy()` on it. */
	readonly client: Client;
	/** Identity of the server (name for error messages, host/port/user). */
	readonly server: PooledServer;
	/** Give the channel slot back. Idempotent. */
	release(): void;
	/**
	 * The *transport* failed (not the command): tear the shared connection
	 * down so the next caller reconnects, and count it toward the breaker.
	 */
	discard(error?: unknown): void;
	/** Notified when the shared connection dies while this lease is held. */
	onConnectionLost(handler: (error: Error) => void): void;
}

class LeaseImpl implements SshLease {
	private released = false;
	private handlers: Array<(error: Error) => void> = [];

	constructor(
		private readonly entry: ServerEntry,
		readonly client: Client,
		readonly server: PooledServer,
	) {}

	release(): void {
		if (this.released) return;
		this.released = true;
		this.handlers = [];
		this.entry.leases.delete(this);
		this.entry.breaker.lastSeenAt = Date.now();
		releaseSlot(this.entry);
	}

	discard(error?: unknown): void {
		if (this.released) return;
		this.released = true;
		this.handlers = [];
		this.entry.leases.delete(this);
		releaseSlot(this.entry);
		const reason = error instanceof Error ? error : new Error(errorMessage(error));
		dropConnection(this.entry, reason);
	}

	/** Called by the pool when the shared connection goes away. */
	connectionLost(error: Error): void {
		const handlers = this.handlers;
		this.handlers = [];
		if (!this.released) {
			this.released = true;
			releaseSlot(this.entry);
		}
		for (const handler of handlers) {
			try {
				handler(error);
			} catch {
				// a listener must not break the teardown of the others
			}
		}
	}

	onConnectionLost(handler: (error: Error) => void): void {
		if (this.released) return;
		this.handlers.push(handler);
	}
}

/**
 * Reserve a channel on `serverId`'s pooled connection, dialling (or waiting
 * for the in-flight dial) if needed.
 *
 * Throws `NOT_FOUND` for an unknown server, `PRECONDITION_FAILED` when the row
 * has no SSH key or the circuit breaker is open, and the raw ssh2 error when
 * the handshake fails (callers already wrap those in `RemoteExecError` /
 * `CommandError`).
 */
export async function acquireSsh(serverId: string): Promise<SshLease> {
	const entry = getEntry(serverId);
	assertBreakerClosed(entry);
	await reserveSlot(entry);
	let connected: Connected;
	try {
		connected = await connect(entry);
	} catch (error) {
		releaseSlot(entry);
		throw error;
	}
	const lease = new LeaseImpl(entry, connected.client, connected.server);
	entry.leases.add(lease);
	return lease;
}
