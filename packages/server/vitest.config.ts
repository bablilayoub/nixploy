import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Unit tests: pure/logic-heavy modules with mocked boundaries.
		// Tenancy suite (`trpc/tenancy.test.ts`) needs DATABASE_URL_TEST; it
		// skips when unset so the default run stays offline.
		include: ["src/**/*.test.ts"],
		environment: "node",
		env: {
			// Deterministic key for encryption tests (never a real secret).
			ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		},
	},
});
