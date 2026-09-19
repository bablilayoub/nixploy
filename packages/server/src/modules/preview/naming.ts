import { createHash } from "node:crypto";
import { getWildcardDomain } from "../application/paths";

/**
 * The key a preview variant is named after: the PR number for a pull-request
 * preview, `b<6 hex>` of the ref for a branch preview. One alphabet for both
 * so every consumer (service name, hosts, Traefik keys, the reserved
 * app-name pattern) keeps a single shape.
 */
export const PREVIEW_KEY_RE = /^(\d{1,10}|b[0-9a-f]{6})$/;

export function assertPreviewKey(key: string): void {
	if (!PREVIEW_KEY_RE.test(key)) {
		throw new Error(`Invalid pull request number or preview key: ${key}`);
	}
}

/** Deterministic: the same ref always maps to the same variant, so creating it twice is a conflict, not a duplicate. */
export function previewKeyForRef(ref: string): string {
	return `b${createHash("sha1").update(ref.trim()).digest("hex").slice(0, 6)}`;
}

/**
 * Pure naming rules for PR previews, kept in a leaf module so the comment
 * renderer, the compose helpers and the lifecycle in `./index.ts` can all
 * share them without importing each other.
 */

export function assertNumericPullRequest(pullRequestNumber: string): void {
	if (!/^\d{1,10}$/.test(pullRequestNumber)) {
		throw new Error(`Invalid pull request number: ${pullRequestNumber}`);
	}
}

/**
 * Variant name for a PR preview: `<appName>-pr-<n>`. For an application this
 * is the swarm service; for a compose service it is the whole compose project
 * / stack (and therefore also its private `<appName>-net`), which is what
 * keeps a preview from ever colliding with the production stack.
 */
export function previewAppName(appName: string, pullRequestNumber: string): string {
	assertPreviewKey(pullRequestNumber);
	return `${appName}-pr-${pullRequestNumber}`;
}

/** Wildcard host for an application PR preview: `pr-<n>-<appName>.<wildcardDomain>`. */
export function previewHost(appName: string, pullRequestNumber: string): string {
	assertPreviewKey(pullRequestNumber);
	return `pr-${pullRequestNumber}-${appName}.${getWildcardDomain()}`;
}

/**
 * Wildcard host of one compose service's preview:
 * `pr-<n>-<appName>-<serviceName>.<wildcardDomain>`. The isolation suffix is
 * deliberately left out — it may be regenerated, and the host has to stay
 * reproducible from the parent row alone (the "preview removed" PR comment is
 * rendered after the preview row is already gone).
 */
export function previewComposeHost(
	appName: string,
	pullRequestNumber: string,
	serviceName: string,
): string {
	assertPreviewKey(pullRequestNumber);
	return `pr-${pullRequestNumber}-${appName}-${serviceName}.${getWildcardDomain()}`;
}

/** `previewLimit <= 0` means "no cap". */
export function previewLimitReached(current: number, limit: number | null | undefined): boolean {
	if (!limit || limit <= 0) return false;
	return current >= limit;
}

/** Expiry a webhook-created preview inherits from `previewTtlHours`. */
export function previewExpiryFromTtl(
	ttlHours: number | null | undefined,
	now: Date = new Date(),
): Date | null {
	if (!ttlHours || ttlHours <= 0) return null;
	return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}
