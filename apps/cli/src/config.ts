import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
	apiUrl: string;
	apiKey: string;
}

const CONFIG_PATH = join(homedir(), ".nixploy", "config.json");

const DEFAULT_API_URL = "http://localhost:3000";

export function configPath(): string {
	return CONFIG_PATH;
}

export function loadConfig(): Partial<CliConfig> {
	if (!existsSync(CONFIG_PATH)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<CliConfig>;
	} catch {
		return {};
	}
}

export function saveConfig(config: Partial<CliConfig>): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, "\t")}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

/**
 * Resolve the effective API URL / key. Precedence:
 *   CLI flag > environment variable > ~/.nixploy/config.json > default
 */
export function resolveApiUrl(flag?: string): string {
	return (flag ?? process.env.NIXPLOY_API_URL ?? loadConfig().apiUrl ?? DEFAULT_API_URL).replace(
		/\/+$/,
		"",
	);
}

export function resolveApiKey(flag?: string): string {
	const key = flag ?? process.env.NIXPLOY_API_KEY ?? loadConfig().apiKey;
	if (!key) {
		throw new Error("No API key configured. Run `nixploy auth login` or set NIXPLOY_API_KEY.");
	}
	return key;
}
