import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError, usageError } from "./errors.js";

/** One stored credential set. `organizationId` pins a multi-org API key. */
export interface Profile {
	apiUrl: string;
	apiKey: string;
	organizationId?: string;
}

/**
 * `~/.nixploy/config.json`. Profiles were added in 0.2; a pre-0.2 file with
 * top-level `apiUrl`/`apiKey` is read as the `default` profile and rewritten
 * on the next `auth login`.
 */
export interface CliConfig {
	/** Profile used when neither --profile nor NIXPLOY_PROFILE is set. */
	current?: string;
	profiles?: Record<string, Profile>;
	/** Legacy single-profile fields (still honoured for reads). */
	apiUrl?: string;
	apiKey?: string;
}

const CONFIG_PATH = join(homedir(), ".nixploy", "config.json");

const DEFAULT_API_URL = "http://localhost:3000";

export const DEFAULT_PROFILE = "default";

export function configPath(): string {
	return CONFIG_PATH;
}

export function loadConfig(): CliConfig {
	if (!existsSync(CONFIG_PATH)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as CliConfig;
	} catch {
		return {};
	}
}

export function saveConfig(config: CliConfig): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, "\t")}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
}

/** Profile name in effect: --profile > NIXPLOY_PROFILE > config.current > "default". */
export function activeProfileName(): string {
	return process.env.NIXPLOY_PROFILE?.trim() || loadConfig().current?.trim() || DEFAULT_PROFILE;
}

/** Every stored profile, with the legacy top-level pair folded in as `default`. */
export function listProfiles(config: CliConfig = loadConfig()): Record<string, Profile> {
	const profiles: Record<string, Profile> = { ...(config.profiles ?? {}) };
	if (!profiles[DEFAULT_PROFILE] && config.apiUrl && config.apiKey) {
		profiles[DEFAULT_PROFILE] = { apiUrl: config.apiUrl, apiKey: config.apiKey };
	}
	return profiles;
}

export function readProfile(name = activeProfileName()): Profile | undefined {
	return listProfiles()[name];
}

/** Write one profile and make it current. Keeps the legacy fields in sync. */
export function writeProfile(name: string, profile: Profile): void {
	const config = loadConfig();
	const profiles = { ...listProfiles(config), [name]: profile };
	saveConfig({ current: name, profiles, apiUrl: profile.apiUrl, apiKey: profile.apiKey });
}

export function removeProfile(name: string): boolean {
	const config = loadConfig();
	const profiles = listProfiles(config);
	if (!profiles[name]) return false;
	delete profiles[name];
	const current = config.current === name ? Object.keys(profiles)[0] : config.current;
	const fallback = current ? profiles[current] : undefined;
	saveConfig({
		current,
		profiles,
		apiUrl: fallback?.apiUrl,
		apiKey: fallback?.apiKey,
	});
	return true;
}

/**
 * Resolve the effective API URL. Precedence:
 *   --url flag > NIXPLOY_API_URL / NIXPLOY_URL > active profile > default
 */
export function resolveApiUrl(flag?: string): string {
	const fromEnv = process.env.NIXPLOY_API_URL ?? process.env.NIXPLOY_URL;
	const url = flag ?? fromEnv ?? readProfile()?.apiUrl ?? DEFAULT_API_URL;
	return url.replace(/\/+$/, "");
}

/** Same precedence as {@link resolveApiUrl}; throws (exit 2) when unset. */
export function resolveApiKey(flag?: string): string {
	const key = flag ?? process.env.NIXPLOY_API_KEY ?? readProfile()?.apiKey;
	if (!key) {
		throw usageError(
			"No API key configured. Run `nixploy auth login --url <url>` or set NIXPLOY_API_KEY.",
		);
	}
	return key;
}

/** Organization pinned for multi-org keys (sent as `x-organization-id`). */
export function resolveOrganizationId(flag?: string): string | undefined {
	return flag ?? process.env.NIXPLOY_ORG_ID ?? readProfile()?.organizationId;
}

/** Update the active profile in place (used by `org use`). */
export function updateActiveProfile(patch: Partial<Profile>): Profile {
	const name = activeProfileName();
	const current = readProfile(name);
	if (!current) {
		throw new CliError(`No credentials stored for profile "${name}". Run \`nixploy auth login\`.`);
	}
	const next = { ...current, ...patch };
	writeProfile(name, next);
	return next;
}
