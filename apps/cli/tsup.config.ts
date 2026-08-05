import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node22",
	platform: "node",
	outDir: "dist",
	clean: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
});
