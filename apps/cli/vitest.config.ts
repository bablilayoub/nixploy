import { fileURLToPath } from "node:url";

/**
 * The CLI has no vitest of its own in `package.json` — the binary comes from
 * `@nixploy/server`'s dev dependency (see the `test` script), so this file
 * cannot `import { defineConfig } from "vitest/config"`: `vitest` is not
 * resolvable from `apps/cli/node_modules`. A plain object works the same.
 *
 * Tests here are pure unit tests over the command registry, the output
 * helpers and the argument parsers; nothing talks to a panel.
 *
 * `registry.test.ts` imports one dependency-free module from the server
 * package by relative path (`trpc/procedure-docs.ts`) to cross-check that
 * every CLI command maps to a documented procedure, so the root must cover
 * the repo, not just `apps/cli`.
 */
export default {
	root: fileURLToPath(new URL("../../", import.meta.url)),
	test: {
		include: ["apps/cli/src/**/*.test.ts"],
		environment: "node",
	},
};
