import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Unit tests only: pure/logic-heavy modules with mocked boundaries.
		// No live Docker, database, or network access.
		include: ["src/**/*.test.ts"],
		environment: "node",
		env: {
			// Deterministic key for encryption tests (never a real secret).
			ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		},
	},
});
