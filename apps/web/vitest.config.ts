import { fileURLToPath } from "node:url";

/**
 * Unit tests for the panel's pure modules — URL/redirect sanitizing, error
 * messages, formatters, the dotenv reader and the pure halves of two hooks.
 * Nothing here renders React or talks to a panel, so the environment is
 * `node`; a component test would need jsdom + testing-library, which the
 * workspace deliberately does not carry.
 *
 * `apps/web` has no `vitest` dependency of its own (like `apps/cli`): the
 * binary comes from `@nixploy/server`'s dev dependency, which is why the
 * `test` script shells through `pnpm -F @nixploy/server exec` and why this
 * file cannot `import { defineConfig } from "vitest/config"` — `vitest` is
 * not resolvable from `apps/web/node_modules`. A plain object works the same.
 *
 * `root` is the repo root so the include glob and the paths below read the
 * same from any cwd; the `@/` alias mirrors `tsconfig.json`'s `paths`.
 */
export default {
	root: fileURLToPath(new URL("../../", import.meta.url)),
	resolve: {
		alias: {
			"@/": fileURLToPath(new URL("./src/", import.meta.url)),
		},
	},
	test: {
		include: ["apps/web/src/**/*.test.ts"],
		environment: "node",
	},
};
