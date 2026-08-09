import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as {
	version: string;
};

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
	define: {
		__CLI_VERSION__: JSON.stringify(version),
	},
});
