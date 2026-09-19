import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The production image runs `apps/web/server.ts` and `apps/web/worker.ts`
 * through tsx's CommonJS loader, which refuses ESM-only packages with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. The Octokit packages are ESM-only, so
 * `modules/git/github.ts` must never be reachable from a boot entry through
 * STATIC imports — only through `await import(...)` at request time. Both
 * roles crashed at start on 2026-09-20 when a worker-side module imported
 * it two hops away; local tsx does not reproduce the failure, only the
 * image does, hence this graph walk.
 */

const ROOT = path.resolve(__dirname, "../../..");
const ENTRIES = ["apps/web/server.ts", "apps/web/worker.ts"];
const FORBIDDEN = ["packages/server/src/modules/git/github.ts"];

const STATIC_IMPORT_RE = /^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+["']([^"']+)["']/gm;

function resolveRelative(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;
	const base = path.resolve(path.dirname(fromFile), specifier);
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		path.join(base, "index.ts"),
		base.replace(/\.js$/, ".ts"),
	]) {
		try {
			readFileSync(candidate);
			return candidate;
		} catch {
			// next candidate
		}
	}
	return null;
}

/** BFS over static imports; returns the chain to the first forbidden file, or null. */
function findStaticPath(entry: string, forbidden: Set<string>): string[] | null {
	const start = path.resolve(ROOT, entry);
	const parents = new Map<string, string | null>([[start, null]]);
	const queue = [start];
	while (queue.length > 0) {
		const file = queue.shift() as string;
		if (forbidden.has(file)) {
			const chain: string[] = [];
			for (let cursor: string | null = file; cursor; cursor = parents.get(cursor) ?? null) {
				chain.unshift(path.relative(ROOT, cursor));
			}
			return chain;
		}
		let source: string;
		try {
			source = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const specifiers: string[] = [];
		for (const match of source.matchAll(STATIC_IMPORT_RE)) specifiers.push(match[1] as string);
		for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) specifiers.push(match[1] as string);
		for (const specifier of specifiers) {
			const resolved = resolveRelative(file, specifier);
			if (!resolved || parents.has(resolved)) continue;
			parents.set(resolved, file);
			queue.push(resolved);
		}
	}
	return null;
}

describe("boot entries never import the GitHub client statically", () => {
	const forbidden = new Set(FORBIDDEN.map((file) => path.resolve(ROOT, file)));
	for (const entry of ENTRIES) {
		it(`${entry} keeps modules/git/github.ts behind a dynamic import`, () => {
			const chain = findStaticPath(entry, forbidden);
			expect(chain, chain ? `static chain: ${chain.join(" → ")}` : "").toBeNull();
		});
	}
});
