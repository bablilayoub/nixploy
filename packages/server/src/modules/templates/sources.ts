import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { simpleGit } from "simple-git";
import { db } from "../../db";
import { templateSources } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { bestEffort } from "../../utils/best-effort";
import {
	assertSafeGitCloneUrl,
	assertSafeGitRef,
	assertSafeOutboundUrl,
	pinnedFetch,
} from "../../utils/public-url";
import { getConfigDir } from "../deployment/paths";
import { gitProtocolEnv } from "../deployment/sources";
import { badRequest, notFound } from "../errors";
import { checkCatalogImages, extractImagesFromCompose } from "./images";
import { parseTemplateIndex } from "./schema";
import type { Template } from "./types";

/**
 * Remote template catalogs (product audit, Platform row "Templates are a
 * fixed TS catalog").
 *
 * A source is an organization's own list of templates in the SAME `Template`
 * shape as the built-in catalog. Syncing fetches it, validates every entry
 * with zod, probes the images it references and writes the accepted entries
 * to `<config>/templates/sources/<id>.json` (0600). Listing merges the cache
 * into the built-in catalog for that organization only — nothing is fetched
 * on the read path, so a dead source never slows the gallery down.
 *
 * Egress: `http-json` URLs go through `assertSafeOutboundUrl` + `pinnedFetch`
 * (no redirects followed, body capped, only vetted addresses dialled); `git`
 * URLs go through `assertSafeGitCloneUrl` and are cloned with the hardened
 * git environment (`gitProtocolEnv` — https/ssh only, no credential helpers,
 * no terminal prompt).
 */

const log = createLogger("template-sources");

export type TemplateSourceRow = typeof templateSources.$inferSelect;

/** Remote ids are namespaced so they can never shadow a built-in template. */
export const REMOTE_ID_SEPARATOR = "/";

/** Cap on a fetched index document. */
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const CLONE_TIMEOUT_MS = 120_000;

/** Path inside a git source that holds the index. */
export const GIT_INDEX_PATH = "templates/index.json";

/** `<config>/templates/sources` — one JSON cache file per source. */
export function getTemplateSourcesDir(): string {
	return path.join(getConfigDir(), "templates", "sources");
}

/** Cache file of one source. The id is a UUID, so it is already path-safe. */
export function getTemplateSourceCachePath(templateSourceId: string): string {
	return path.join(getTemplateSourcesDir(), `${sanitizeId(templateSourceId)}.json`);
}

/** Checkout directory of a git-backed source. */
function getTemplateSourceRepoDir(templateSourceId: string): string {
	return path.join(getConfigDir(), "templates", "repos", sanitizeId(templateSourceId));
}

/** Ids come from the database (UUIDs), but never build a path from an unfiltered string. */
function sanitizeId(value: string): string {
	const safe = value.replace(/[^a-zA-Z0-9_-]/g, "");
	if (!safe) throw badRequest("Invalid template source id");
	return safe;
}

/** `<sourceId>/<templateId>` — the id the panel and `template.deploy` use. */
export function remoteTemplateId(templateSourceId: string, templateId: string): string {
	return `${templateSourceId}${REMOTE_ID_SEPARATOR}${templateId}`;
}

/** Split a namespaced id back apart; `null` for a built-in id. */
export function parseRemoteTemplateId(
	templateId: string,
): { templateSourceId: string; localId: string } | null {
	const index = templateId.indexOf(REMOTE_ID_SEPARATOR);
	if (index <= 0) return null;
	return {
		templateSourceId: templateId.slice(0, index),
		localId: templateId.slice(index + 1),
	};
}

/** A template that came from a source, with the badge the gallery renders. */
export interface SourcedTemplate extends Template {
	source: { templateSourceId: string; name: string };
}

interface TemplateSourceCache {
	version: 1;
	syncedAt: string;
	templates: Template[];
	/** Entries dropped by validation, kept so the settings UI can show them. */
	rejected: string[];
	/** Images the probe could not resolve (templates are kept anyway). */
	imageWarnings: string[];
}

// ── fetching ────────────────────────────────────────────────────────────────

async function fetchJsonIndex(url: string): Promise<unknown> {
	const target = await assertSafeOutboundUrl(url, { allowPrivate: true });
	const response = await pinnedFetch(target, {
		timeoutMs: REQUEST_TIMEOUT_MS,
		maxBytes: MAX_INDEX_BYTES,
		headers: { accept: "application/json" },
	});
	if (!response.ok) {
		throw badRequest(
			`Template source returned HTTP ${response.status}${
				response.status >= 300 && response.status < 400 ? " (redirects are not followed)" : ""
			}`,
		);
	}
	try {
		return response.json();
	} catch {
		throw badRequest("Template source did not return valid JSON");
	}
}

/**
 * Shallow-clone a git source on the Nixploy host and read
 * `templates/index.json`. Only https/ssh transports are possible
 * (`gitProtocolEnv`), and the checkout is discarded after the read — the
 * cache file is the only thing that survives.
 */
async function fetchGitIndex(row: TemplateSourceRow): Promise<unknown> {
	await assertSafeGitCloneUrl(row.url.replace(/^(https?:\/\/)[^/]*@/i, "$1"));
	const branch = row.branch ? assertSafeGitRef(row.branch) : null;
	const dir = getTemplateSourceRepoDir(row.templateSourceId);
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const git = simpleGit({ baseDir: dir, timeout: { block: CLONE_TIMEOUT_MS } });
	// simple-git's env() replaces the child environment wholesale — keep PATH.
	git.env({ ...process.env, ...gitProtocolEnv() });
	try {
		await git.init();
		await git.addRemote("origin", row.url);
		await git.fetch(["--depth", "1", "origin", ...(branch ? [branch] : ["HEAD"])]);
		await git.reset(["--hard", "FETCH_HEAD"]);
		const file = path.join(dir, GIT_INDEX_PATH);
		let raw: string;
		try {
			raw = await readFile(file, "utf8");
		} catch {
			throw badRequest(`The repository has no ${GIT_INDEX_PATH}`);
		}
		if (raw.length > MAX_INDEX_BYTES) {
			throw badRequest(`${GIT_INDEX_PATH} is larger than ${MAX_INDEX_BYTES} bytes`);
		}
		try {
			return JSON.parse(raw);
		} catch {
			throw badRequest(`${GIT_INDEX_PATH} is not valid JSON`);
		}
	} finally {
		await bestEffort(`clean up template source checkout ${row.templateSourceId}`, () =>
			rm(dir, { recursive: true, force: true }),
		);
	}
}

// ── sync ────────────────────────────────────────────────────────────────────

export interface SyncTemplateSourceResult {
	templateSourceId: string;
	templateCount: number;
	/** Entries dropped by validation, `<id>: <reason>`. */
	rejected: string[];
	/** Images the registry probe could not confirm. */
	imageWarnings: string[];
	syncedAt: string;
}

export interface SyncTemplateSourceOptions {
	/** Probe every referenced image against its registry (default true). */
	probeImages?: boolean;
}

/**
 * Fetch, validate and cache one source. Throws (and records `lastError`) when
 * the document cannot be read at all; individual bad entries are dropped with
 * a reason instead.
 *
 * The image probe is a WARNING, never a rejection: a template pointing at a
 * private registry is perfectly valid, we simply cannot confirm its tag
 * anonymously.
 */
export async function syncTemplateSource(
	row: TemplateSourceRow,
	options: SyncTemplateSourceOptions = {},
): Promise<SyncTemplateSourceResult> {
	const syncedAt = new Date();
	try {
		const document = row.kind === "git" ? await fetchGitIndex(row) : await fetchJsonIndex(row.url);
		const { templates, rejected } = parseTemplateIndex(document);

		let imageWarnings: string[] = [];
		if (options.probeImages !== false && templates.length > 0) {
			const images = [
				...new Set(templates.flatMap((template) => extractImagesFromCompose(template.compose))),
			];
			if (images.length > 0) {
				const results = await checkCatalogImages({ images, concurrency: 4 }).catch(
					(error: unknown) => {
						log.warn(`Image probe failed for template source ${row.templateSourceId}`, {
							error: error instanceof Error ? error.message : String(error),
						});
						return [];
					},
				);
				imageWarnings = results
					.filter((result) => !result.ok)
					.map((result) => `${result.image}: ${result.error ?? "not found"}`);
			}
		}

		await writeTemplateSourceCache(row.templateSourceId, {
			version: 1,
			syncedAt: syncedAt.toISOString(),
			templates,
			rejected,
			imageWarnings,
		});
		await db
			.update(templateSources)
			.set({ lastSyncAt: syncedAt, lastError: null, templateCount: templates.length })
			.where(eq(templateSources.templateSourceId, row.templateSourceId));

		return {
			templateSourceId: row.templateSourceId,
			templateCount: templates.length,
			rejected,
			imageWarnings,
			syncedAt: syncedAt.toISOString(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(templateSources)
			.set({ lastSyncAt: syncedAt, lastError: message })
			.where(eq(templateSources.templateSourceId, row.templateSourceId))
			.catch(() => {});
		throw error;
	}
}

async function writeTemplateSourceCache(
	templateSourceId: string,
	cache: TemplateSourceCache,
): Promise<void> {
	const dir = getTemplateSourcesDir();
	await mkdir(dir, { recursive: true, mode: 0o700 });
	// Compose bodies may carry example credentials — owner-only, like every
	// other rendered artefact under the config dir.
	await writeFile(getTemplateSourceCachePath(templateSourceId), JSON.stringify(cache), {
		encoding: "utf8",
		mode: 0o600,
	});
}

async function readTemplateSourceCache(
	templateSourceId: string,
): Promise<TemplateSourceCache | null> {
	try {
		const raw = await readFile(getTemplateSourceCachePath(templateSourceId), "utf8");
		const parsed = JSON.parse(raw) as TemplateSourceCache;
		if (!Array.isArray(parsed.templates)) return null;
		return parsed;
	} catch {
		// Never synced, cache pruned, or a corrupt file — the source simply
		// contributes nothing until its next sync.
		return null;
	}
}

/** Diagnostics of the last sync, for the settings UI. */
export async function readTemplateSourceReport(templateSourceId: string): Promise<{
	rejected: string[];
	imageWarnings: string[];
	syncedAt: string | null;
} | null> {
	const cache = await readTemplateSourceCache(templateSourceId);
	if (!cache) return null;
	return {
		rejected: cache.rejected ?? [],
		imageWarnings: cache.imageWarnings ?? [],
		syncedAt: cache.syncedAt ?? null,
	};
}

/** Drop a source's cache (and any leftover checkout) when it is deleted. */
export async function removeTemplateSourceCache(templateSourceId: string): Promise<void> {
	await rm(getTemplateSourceCachePath(templateSourceId), { force: true }).catch(() => {});
	await rm(getTemplateSourceRepoDir(templateSourceId), { recursive: true, force: true }).catch(
		() => {},
	);
}

// ── rows ────────────────────────────────────────────────────────────────────

export async function listTemplateSources(organizationId: string): Promise<TemplateSourceRow[]> {
	return db.query.templateSources.findMany({
		where: eq(templateSources.organizationId, organizationId),
		orderBy: asc(templateSources.createdAt),
	});
}

export async function findTemplateSource(
	templateSourceId: string,
	organizationId: string,
): Promise<TemplateSourceRow> {
	const row = await db.query.templateSources.findFirst({
		where: and(
			eq(templateSources.templateSourceId, templateSourceId),
			eq(templateSources.organizationId, organizationId),
		),
	});
	if (!row) throw notFound("Template source not found");
	return row;
}

/**
 * Validate a source URL for the kind it claims to be. Run at save time AND
 * again at sync time (`syncTemplateSource`) — a row saved before a policy
 * change must not stay trusted forever.
 */
export async function assertTemplateSourceUrl(
	kind: "git" | "http-json",
	url: string,
): Promise<void> {
	if (kind === "git") {
		await assertSafeGitCloneUrl(url.replace(/^(https?:\/\/)[^/]*@/i, "$1"));
		return;
	}
	await assertSafeOutboundUrl(url, { allowPrivate: true });
}

// ── merged catalog ──────────────────────────────────────────────────────────

/** Cached templates of every enabled source of one organization, namespaced. */
export async function listSourcedTemplates(organizationId: string): Promise<SourcedTemplate[]> {
	const rows = (await listTemplateSources(organizationId)).filter((row) => row.enabled);
	const out: SourcedTemplate[] = [];
	for (const row of rows) {
		const cache = await readTemplateSourceCache(row.templateSourceId);
		if (!cache) continue;
		for (const template of cache.templates) {
			out.push({
				...template,
				id: remoteTemplateId(row.templateSourceId, template.id),
				source: { templateSourceId: row.templateSourceId, name: row.name },
			});
		}
	}
	return out;
}

/** One template from a source, by its namespaced id. `null` when it is built-in. */
export async function findSourcedTemplate(
	organizationId: string,
	templateId: string,
): Promise<SourcedTemplate | null> {
	const parsed = parseRemoteTemplateId(templateId);
	if (!parsed) return null;
	const row = await db.query.templateSources.findFirst({
		where: and(
			eq(templateSources.templateSourceId, parsed.templateSourceId),
			eq(templateSources.organizationId, organizationId),
		),
	});
	if (!row?.enabled) return null;
	const cache = await readTemplateSourceCache(row.templateSourceId);
	const template = cache?.templates.find((entry) => entry.id === parsed.localId);
	if (!template) return null;
	return {
		...template,
		id: templateId,
		source: { templateSourceId: row.templateSourceId, name: row.name },
	};
}
