/**
 * Fan-out helpers for the crons that touch many servers.
 *
 * Every periodic pass (status reconciler, metrics sampler, backup scheduler,
 * uptime probes) walks rows that each belong to a server. Doing that row by
 * row means one unreachable host stretches the whole pass by its per-command
 * timeout × its row count (architecture audit #7). Grouping by server and
 * running the groups side by side with a bounded pool keeps a pass proportional
 * to the slowest *server*, not to the number of rows — and the local host
 * (`serverId === null`) is just another group.
 *
 * Deliberately free of SSH imports: the breaker predicate is injected so the
 * helper stays pure and unit-testable.
 */

/** The Nixploy host itself — rows with `serverId === null`. */
export const LOCAL_SERVER_KEY = "__local__";

export const DEFAULT_FANOUT_CONCURRENCY = 4;

/**
 * How many servers a fan-out pass talks to at once
 * (`NIXPLOY_FANOUT_CONCURRENCY`, default 4). Read per call so tests and
 * operators can change it without a restart of the module graph.
 */
export function fanOutConcurrency(override?: number): number {
	if (override && override > 0) return override;
	const raw = Number.parseInt(process.env.NIXPLOY_FANOUT_CONCURRENCY ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_FANOUT_CONCURRENCY;
}

/**
 * Run `fn` over `items` with at most `concurrency` in flight, preserving
 * result order. A rejection aborts the pass — wrap `fn` yourself when one bad
 * item must not stop the rest.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await fn(items[index] as T, index);
		}
	};
	const poolSize = Math.max(1, Math.min(concurrency, items.length));
	await Promise.all(Array.from({ length: poolSize }, () => worker()));
	return results;
}

/**
 * Bucket rows by the server they live on. The key is the server id, or
 * {@link LOCAL_SERVER_KEY} for rows that run on the Nixploy host. Insertion
 * order of the first row of each group is preserved.
 */
export function groupByServer<T>(
	items: readonly T[],
	serverIdOf: (item: T) => string | null | undefined,
): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const key = serverIdOf(item) ?? LOCAL_SERVER_KEY;
		const bucket = groups.get(key);
		if (bucket) bucket.push(item);
		else groups.set(key, [item]);
	}
	return groups;
}

export interface ServerGroup<T> {
	/** `null` for the Nixploy host, otherwise the managed server's id. */
	serverId: string | null;
	items: T[];
}

export interface FanOutOptions {
	/** Servers in flight at once. Default {@link fanOutConcurrency}. */
	concurrency?: number;
	/**
	 * Skip a managed server entirely this pass — used to honour the SSH
	 * circuit breaker. Never called for the local host.
	 */
	skipServer?: (serverId: string) => boolean;
}

export interface FanOutResult {
	/** Groups that ran (local host included). */
	processed: number;
	/** Server ids skipped by `skipServer`. */
	skipped: string[];
}

/**
 * Group `items` by server and hand each group to `handler`, at most
 * `concurrency` servers at a time. A group whose handler throws is logged by
 * the caller — the rejection is swallowed so one dead host cannot abort the
 * pass.
 */
export async function forEachServerGroup<T>(
	items: readonly T[],
	serverIdOf: (item: T) => string | null | undefined,
	handler: (group: ServerGroup<T>) => Promise<void>,
	options: FanOutOptions = {},
): Promise<FanOutResult> {
	const groups = [...groupByServer(items, serverIdOf)].map(([key, group]) => ({
		serverId: key === LOCAL_SERVER_KEY ? null : key,
		items: group,
	}));
	const skipped: string[] = [];
	const runnable = groups.filter((group) => {
		if (group.serverId && options.skipServer?.(group.serverId)) {
			skipped.push(group.serverId);
			return false;
		}
		return true;
	});
	await mapWithConcurrency(runnable, fanOutConcurrency(options.concurrency), async (group) => {
		try {
			await handler(group);
		} catch {
			// The handler owns its own error reporting; a failing server must
			// never take the other groups (or the rest of the pass) down.
		}
	});
	return { processed: runnable.length, skipped };
}
