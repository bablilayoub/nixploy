import { z } from "zod";

/**
 * Size caps for tenant-supplied text that lands in the database or on disk.
 * Zod enforces them at the router boundary so an authenticated user cannot
 * park a 200 MB compose file in `yaml.parse` on the event loop; the
 * `/api/trpc` and REST routes cap the whole request body above this.
 */

/** Compose files, GitOps stack YAML and dotenv blobs: 1 MiB. */
export const MAX_TEXT_BLOB_LENGTH = 1_048_576;

/** Materialised `file` mounts: 256 KiB (config files, certificates, scripts). */
export const MAX_MOUNT_CONTENT_LENGTH = 262_144;

/** `env` / `buildArgs` / compose file / stack YAML input (nullable variants via `.nullish()`). */
export const textBlobSchema = z.string().max(MAX_TEXT_BLOB_LENGTH, {
	message: `Must be at most ${MAX_TEXT_BLOB_LENGTH} characters (1 MiB)`,
});

/** `file` mount content. */
export const mountContentSchema = z.string().max(MAX_MOUNT_CONTENT_LENGTH, {
	message: `Must be at most ${MAX_MOUNT_CONTENT_LENGTH} characters (256 KiB)`,
});

// ── watch paths ───────────────────────────────────────────────────────────────

/** Patterns per application / compose service. */
export const MAX_WATCH_PATHS = 50;
/** Characters per pattern. */
export const MAX_WATCH_PATH_LENGTH = 256;
/** `**` occurrences per pattern — each one compiles to a backtracking `.*`. */
export const MAX_WATCH_PATH_GLOBSTARS = 3;
/**
 * `*` characters per pattern (a `**` counts as two). Every star compiles to
 * an unbounded quantifier and `a*a*a*…` against a long non-matching path is
 * polynomial in the star count, so the total is bounded as well.
 */
export const MAX_WATCH_PATH_STARS = 8;

const countMatches = (value: string, re: RegExp): number => value.match(re)?.length ?? 0;

/**
 * Whether a watch-path pattern is cheap enough to compile to a regex.
 * Shared by the zod schema (new rows) and the webhook matcher (rows written
 * before the caps existed are matched by prefix only).
 */
export function isSafeWatchPathPattern(pattern: string): boolean {
	if (pattern.length > MAX_WATCH_PATH_LENGTH) return false;
	if (countMatches(pattern, /\*\*/g) > MAX_WATCH_PATH_GLOBSTARS) return false;
	if (countMatches(pattern, /\*/g) > MAX_WATCH_PATH_STARS) return false;
	return true;
}

export const watchPathSchema = z
	.string()
	.max(MAX_WATCH_PATH_LENGTH, {
		message: `Watch paths must be at most ${MAX_WATCH_PATH_LENGTH} characters`,
	})
	.refine(isSafeWatchPathPattern, {
		message: `Watch paths may contain at most ${MAX_WATCH_PATH_GLOBSTARS} "**" and ${MAX_WATCH_PATH_STARS} "*" wildcards`,
	});

/** `watchPaths` array input (routers wrap it in `.nullable().optional()` / `.nullish()`). */
export const watchPathsSchema = z.array(watchPathSchema).max(MAX_WATCH_PATHS, {
	message: `At most ${MAX_WATCH_PATHS} watch paths`,
});
