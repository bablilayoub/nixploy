import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach } from "vitest";

/**
 * Scratch directories for tests that write real files (metrics JSONL, compose
 * files, deploy logs). Six suites hand-rolled the same `mkdtemp` block before
 * this existed (audit F8).
 */

/** One fresh directory under the OS temp dir. Caller removes it (or leaks it). */
export async function makeTempDir(prefix = "nixploy-test-"): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

/**
 * A directory recreated before every test in the file and removed when the
 * file finishes:
 *
 * ```ts
 * const dir = useTempDir("nixploy-history-");
 * vi.mock("../application/paths", () => ({ getConfigDir: () => dir.path }));
 * ```
 *
 * `dir.path` is a live getter, so it can be captured in a mock factory that
 * runs once while the value still changes per test.
 */
export function useTempDir(prefix?: string): { readonly path: string } {
	const created: string[] = [];
	let current = "";

	beforeEach(async () => {
		current = await makeTempDir(prefix);
		created.push(current);
	});

	afterAll(async () => {
		await Promise.all(
			created.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
		);
	});

	return {
		get path() {
			return current;
		},
	};
}
