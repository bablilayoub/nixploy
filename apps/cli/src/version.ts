import { readFileSync } from "node:fs";

// This path is the package manifest from both src/ and the published dist/.
const { version } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const CLI_VERSION: string = version;
