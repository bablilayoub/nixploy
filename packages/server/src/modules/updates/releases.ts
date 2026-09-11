import { assertPublicHttpsUrl, pinnedFetch } from "../../utils/public-url";
import { badRequest } from "../errors";

/**
 * Release notes and version pinning for the in-app updater (product audit,
 * Platform row "Updater shows digest only").
 *
 * The updater tracked a digest and nothing else: an operator could see that
 * *something* changed but not what, and could not choose which version to
 * roll to. This module answers both — it reads the GitHub release for a tag
 * through the egress guard (`assertPublicHttpsUrl` + `pinnedFetch`: https
 * only, public addresses only, no redirects, capped body) and owns the
 * version-string rules the router and `applyUpdate` share.
 */

/** Repository the official images are built from (`git remote -v`). */
export const NIXPLOY_REPO = "bablilayoub/nixploy";

/** Release bodies are markdown and can be long; the UI only needs the top. */
export const MAX_RELEASE_NOTES_BYTES = 16 * 1024;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Tag of an image ref: `ghcr.io/x/nixploy:v0.2.0@sha256:…` → `v0.2.0`
 * (`""` when untagged). Same rule as `apply.ts#imageTag`, duplicated here to
 * keep `check.ts → releases.ts` free of the `check ⇄ apply` import cycle.
 */
export function imageVersionTag(image: string): string {
	const withoutDigest = image.split("@")[0] ?? "";
	const last = withoutDigest.slice(withoutDigest.lastIndexOf("/") + 1);
	const colon = last.indexOf(":");
	return colon === -1 ? "" : last.slice(colon + 1);
}

/** Re-tag an image ref, dropping any digest: `repo:latest` → `repo:v1.2.3`. */
export function withImageTag(image: string, tag: string): string {
	const withoutDigest = image.split("@")[0] ?? image;
	const slash = withoutDigest.lastIndexOf("/");
	const colon = withoutDigest.indexOf(":", slash + 1);
	const repository = colon === -1 ? withoutDigest : withoutDigest.slice(0, colon);
	return `${repository}:${tag}`;
}

/** `v1.2.3` / `1.2.3`. Pre-release suffixes are deliberately not accepted. */
export const VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/;

export interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
}

/** Parse a plain `x.y.z` (with optional `v`), or null when it is not one. */
export function parseVersion(value: string): ParsedVersion | null {
	const trimmed = value.trim();
	if (!VERSION_PATTERN.test(trimmed)) return null;
	const [major, minor, patch] = trimmed.replace(/^v/, "").split(".").map(Number);
	if (major === undefined || minor === undefined || patch === undefined) return null;
	return { major, minor, patch };
}

/** `-1` / `0` / `1`; throws nothing — unparseable versions compare equal. */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;
	if (left.major !== right.major) return left.major < right.major ? -1 : 1;
	if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
	if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
	return 0;
}

/** Canonical release tag for a version string (`1.2.3` → `v1.2.3`). */
export function releaseTag(version: string): string {
	const parsed = parseVersion(version);
	if (!parsed) {
		throw badRequest(`Invalid version "${version}" — expected a release like 1.2.3 or v1.2.3`);
	}
	return `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export interface ReleaseInfo {
	tag: string;
	name: string | null;
	/** Markdown body, truncated to {@link MAX_RELEASE_NOTES_BYTES}. */
	notes: string | null;
	/** True when the body hit the cap. */
	notesTruncated: boolean;
	url: string | null;
	publishedAt: string | null;
}

/** Cut markdown at a character budget without splitting mid-line. */
export function truncateNotes(
	body: string,
	maxBytes = MAX_RELEASE_NOTES_BYTES,
): {
	notes: string;
	truncated: boolean;
} {
	if (Buffer.byteLength(body, "utf8") <= maxBytes) {
		return { notes: body, truncated: false };
	}
	// Byte budget, so a body of multi-byte characters cannot slip past it.
	let cut = body.slice(0, maxBytes);
	while (Buffer.byteLength(cut, "utf8") > maxBytes) cut = cut.slice(0, -1);
	const lastBreak = cut.lastIndexOf("\n");
	if (lastBreak > maxBytes / 2) cut = cut.slice(0, lastBreak);
	return { notes: `${cut.trimEnd()}\n\n…`, truncated: true };
}

/** Shape of the GitHub release payload we read (everything else is ignored). */
interface GithubRelease {
	tag_name?: unknown;
	name?: unknown;
	body?: unknown;
	html_url?: unknown;
	published_at?: unknown;
	draft?: unknown;
	prerelease?: unknown;
}

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Fetch one release. Returns null when the tag has no release (a build with
 * no GitHub release is normal for `:latest`) instead of throwing — release
 * notes are a nicety, never a reason for the update check to fail.
 *
 * `options.tag` must already be canonical (`releaseTag`), so nothing
 * caller-controlled reaches the URL path unvalidated.
 */
export async function fetchRelease(
	tag: string,
	options: { repo?: string } = {},
): Promise<ReleaseInfo | null> {
	const canonical = releaseTag(tag);
	const repo = options.repo ?? NIXPLOY_REPO;
	const payload = await getRelease(`releases/tags/${encodeURIComponent(canonical)}`, repo);
	return payload ? toReleaseInfo(payload, repo, canonical) : null;
}

/** Parse a GitHub release payload into our shape (shared by both fetchers). */
function toReleaseInfo(payload: GithubRelease, repo: string, fallbackTag: string): ReleaseInfo {
	const body = asString(payload.body);
	const { notes, truncated } = body ? truncateNotes(body) : { notes: null, truncated: false };
	const tag = asString(payload.tag_name) ?? fallbackTag;
	return {
		tag,
		name: asString(payload.name),
		notes,
		notesTruncated: truncated,
		url: asString(payload.html_url) ?? `https://github.com/${repo}/releases/tag/${tag}`,
		publishedAt: asString(payload.published_at),
	};
}

async function getRelease(pathname: string, repo: string): Promise<GithubRelease | null> {
	const target = await assertPublicHttpsUrl(`https://api.github.com/repos/${repo}/${pathname}`);
	const response = await pinnedFetch(target, {
		timeoutMs: REQUEST_TIMEOUT_MS,
		// The body is markdown plus metadata — 512 KiB is plenty and bounds
		// what an upstream could make us hold in memory.
		maxBytes: 512 * 1024,
		headers: {
			accept: "application/vnd.github+json",
			"user-agent": "nixploy-updater",
			"x-github-api-version": "2022-11-28",
		},
	});
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`GitHub returned HTTP ${response.status} for ${repo}/${pathname}`);
	}
	try {
		return response.json() as GithubRelease;
	} catch {
		throw new Error("GitHub returned a release payload that is not JSON");
	}
}

/**
 * Newest published release of the repository. Used when the tracked image is
 * a moving tag (`:latest`), where there is no version to look up.
 */
export async function fetchLatestRelease(
	options: { repo?: string } = {},
): Promise<ReleaseInfo | null> {
	const repo = options.repo ?? NIXPLOY_REPO;
	const payload = await getRelease("releases/latest", repo);
	return payload ? toReleaseInfo(payload, repo, "latest") : null;
}

export interface AssertPinnableOptions {
	/** Version the panel is running (`getAppVersion()`). */
	currentVersion: string;
	/** Version the operator asked for. */
	targetVersion: string;
	/** Explicit acknowledgement that migrations do not roll back. */
	allowDowngrade?: boolean;
	/** Pin from settings; the target may not go past it. */
	pinnedVersion?: string | null;
}

/**
 * Gate a version the operator asked to roll to.
 *
 * A downgrade needs `allowDowngrade: true`: Nixploy applies migrations on
 * boot and never reverses them, so an older image meets a newer schema (see
 * docs/upgrade-notes.md). A pin is the opposite direction — it caps how far
 * forward automatic updates may go.
 */
export function assertVersionAllowed(options: AssertPinnableOptions): { isDowngrade: boolean } {
	const target = parseVersion(options.targetVersion);
	if (!target) {
		throw badRequest(
			`Invalid version "${options.targetVersion}" — expected a release like 1.2.3 or v1.2.3`,
		);
	}
	const isDowngrade = compareVersions(options.targetVersion, options.currentVersion) < 0;
	if (isDowngrade && !options.allowDowngrade) {
		throw badRequest(
			`${releaseTag(options.targetVersion)} is older than the running v${options.currentVersion}. ` +
				"Database migrations are not reversed on downgrade — pass allowDowngrade to proceed anyway.",
		);
	}
	if (options.pinnedVersion && compareVersions(options.targetVersion, options.pinnedVersion) > 0) {
		throw badRequest(
			`This instance is pinned to ${releaseTag(options.pinnedVersion)} — raise or clear the pin first.`,
		);
	}
	return { isDowngrade };
}

/**
 * Should an AUTOMATIC update roll to `candidateVersion`? A pin caps it; an
 * unparseable candidate (a digest-only `:latest` build) is never held back,
 * because there is nothing to compare.
 */
export function autoUpdateAllowed(
	candidateVersion: string | null,
	pinnedVersion: string | null,
): boolean {
	if (!pinnedVersion || !candidateVersion) return true;
	if (!parseVersion(candidateVersion) || !parseVersion(pinnedVersion)) return true;
	return compareVersions(candidateVersion, pinnedVersion) <= 0;
}
