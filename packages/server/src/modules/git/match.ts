import { isSafeWatchPathPattern } from "../../utils/input-limits";
import type { GitWebhookProvider } from "./providers/shared";

/**
 * Pure repo→application matching for webhook deliveries: watch-path globs and
 * the push / preview candidate predicates. No db, no network — unit-tested
 * directly (`webhook-handler.test.ts`).
 */

/** Subset of an application row relevant to push webhook matching. */
export interface WebhookApplicationCandidate {
	sourceType: string;
	repository: string | null;
	owner: string | null;
	branch: string | null;
	autoDeploy: boolean;
	watchPaths: string[] | null;
}

/** Subset of an application row relevant to preview (PR) webhook matching. */
export interface PreviewWebhookCandidate {
	sourceType: string;
	repository: string | null;
	owner: string | null;
	isPreviewDeploymentsActive: boolean;
}

/** Repo identity extracted from a verified webhook delivery. */
export interface WebhookRepoContext {
	provider: GitWebhookProvider;
	repository: string;
	owner: string;
	branch: string;
	changedPaths?: string[];
}

/** Tiny glob: `**` crosses directories, `*` and `?` stay within one segment. */
function globToRegExp(glob: string): RegExp {
	const source = glob
		.split("**")
		.map((part) =>
			part
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, "[^/]"),
		)
		.join(".*");
	return new RegExp(`^${source}$`);
}

/**
 * Compiled glob cache. A push delivery evaluates every (pattern × changed
 * path) pair of every matching application; without the cache each pair
 * recompiled the regex. Bounded FIFO so hostile pattern churn cannot grow it.
 */
const GLOB_CACHE_MAX = 512;
const globCache = new Map<string, RegExp>();

/** Exposed for tests. */
export const globCacheSize = (): number => globCache.size;

function compileGlob(pattern: string): RegExp {
	const cached = globCache.get(pattern);
	if (cached) return cached;
	const compiled = globToRegExp(pattern);
	if (globCache.size >= GLOB_CACHE_MAX) {
		const oldest = globCache.keys().next().value;
		if (oldest !== undefined) globCache.delete(oldest);
	}
	globCache.set(pattern, compiled);
	return compiled;
}

/**
 * Decide whether a delivery's changed files fall under an application's
 * watch paths:
 * - no watch paths configured → every change deploys;
 * - the provider sent no file list (Bitbucket, pull_request events) →
 *   deploy, the filter cannot be evaluated;
 * - otherwise at least one changed path must match a watch path: exact
 *   match, directory prefix (`src` covers `src/index.ts`), or glob.
 */
export const watchPathsMatch = (
	changedPaths: string[] | undefined,
	watchPaths: string[] | null | undefined,
): boolean => {
	const patterns = (watchPaths ?? [])
		.map((pattern) => pattern.trim().replace(/^\/+|\/+$/g, ""))
		.filter(Boolean);
	if (patterns.length === 0) return true;
	if (!changedPaths) return true;
	return changedPaths.some((changed) => {
		const normalized = changed.replace(/^\/+/, "");
		return patterns.some((pattern) => {
			if (normalized === pattern || normalized.startsWith(`${pattern}/`)) return true;
			// Rows written before the input caps existed may hold patterns the
			// zod schema now rejects; they only get exact/prefix matching above.
			if ((pattern.includes("*") || pattern.includes("?")) && isSafeWatchPathPattern(pattern)) {
				return compileGlob(pattern).test(normalized);
			}
			return false;
		});
	});
};

/**
 * Pure repo→application match: same provider, repository and branch, owner
 * compared case-insensitively, auto-deploy enabled, and the delivery's
 * changed files passing the application's watch-path filter.
 */
export const applicationMatchesWebhook = (
	application: WebhookApplicationCandidate,
	webhook: WebhookRepoContext,
): boolean => {
	if (application.sourceType !== webhook.provider) return false;
	if (!application.autoDeploy) return false;
	if (!application.repository || application.repository !== webhook.repository) return false;
	if ((application.owner ?? "").toLowerCase() !== webhook.owner.toLowerCase()) return false;
	if (application.branch !== webhook.branch) return false;
	return watchPathsMatch(webhook.changedPaths, application.watchPaths);
};

/**
 * Pure repo→application match for preview deployments: same provider and
 * repository, owner case-insensitive, previews enabled. Branch is NOT
 * compared — PR head branches differ from the app's production branch.
 */
export const applicationMatchesPreviewWebhook = (
	application: PreviewWebhookCandidate,
	webhook: Pick<WebhookRepoContext, "provider" | "repository" | "owner">,
): boolean => {
	if (application.sourceType !== webhook.provider) return false;
	if (!application.isPreviewDeploymentsActive) return false;
	if (!application.repository || application.repository !== webhook.repository) return false;
	if ((application.owner ?? "").toLowerCase() !== webhook.owner.toLowerCase()) return false;
	return true;
};
