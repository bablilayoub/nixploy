/**
 * A tiny per-process TTL cache for read-only probes that are expensive to
 * repeat: `docker ps`, `docker images`, `docker service ls`, a swarm status
 * inspect. The dashboard polls those every 5-30 s *per open tab*, so ten tabs
 * used to mean ten shell-outs (or ten SSH round-trips) for one answer.
 *
 * Two properties matter:
 * - **TTL** — a value younger than `ttlMs` is reused.
 * - **Single flight** — the in-flight promise is what gets cached, so N
 *   concurrent callers for one key share ONE load instead of racing.
 *
 * A rejected load is never cached: the entry is dropped so the next caller
 * retries immediately (a transient docker hiccup must not be served for the
 * rest of the window). Mutations invalidate explicitly — the cache never
 * guesses.
 *
 * This is deliberately process-local, like the deploy queue's slot accounting
 * and the rate limiters: `nixploy` runs as a single replica by design.
 */

export interface TtlCache<T> {
	/** Cached value for `key`, loading (once) when missing or stale. */
	get(key: string, load: () => Promise<T>): Promise<T>;
	/** Drop one key. */
	invalidate(key: string): void;
	/** Drop every key the predicate accepts (e.g. everything for one server). */
	invalidateWhere(predicate: (key: string) => boolean): void;
	/** Drop everything. */
	clear(): void;
	/** Number of entries currently held (fresh or not) — for tests. */
	readonly size: number;
}

export interface TtlCacheOptions {
	ttlMs: number;
	/** Injectable clock; defaults to `Date.now`. */
	clock?: () => number;
}

export function createTtlCache<T>({ ttlMs, clock = Date.now }: TtlCacheOptions): TtlCache<T> {
	const entries = new Map<string, { at: number; value: Promise<T> }>();

	return {
		get(key, load) {
			const hit = entries.get(key);
			if (hit && clock() - hit.at < ttlMs) return hit.value;

			const value = load();
			const entry = { at: clock(), value };
			entries.set(key, entry);
			// Keep the rejection handled here AND propagated to the caller.
			value.catch(() => {
				if (entries.get(key) === entry) entries.delete(key);
			});
			return value;
		},
		invalidate(key) {
			entries.delete(key);
		},
		invalidateWhere(predicate) {
			for (const key of [...entries.keys()]) {
				if (predicate(key)) entries.delete(key);
			}
		},
		clear() {
			entries.clear();
		},
		get size() {
			return entries.size;
		},
	};
}

/** Default window for docker listings: long enough to collapse tab polls. */
export const DOCKER_LISTING_TTL_MS = 10_000;
