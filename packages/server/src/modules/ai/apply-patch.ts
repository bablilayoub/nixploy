import { badRequest } from "../errors";

/**
 * Parse a Copilot `suggestedPatch` into dotenv KEY=VALUE pairs when possible.
 * Accepts fenced code, bare dotenv, or lines mixed with commentary
 * (only KEY=VALUE lines are kept).
 */

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

export function extractEnvEntries(patch: string): Array<{ key: string; value: string }> {
	const body = patch
		.replace(/^```(?:env|dotenv|bash|sh)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
	const entries: Array<{ key: string; value: string }> = [];
	for (const raw of body.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = ENV_LINE.exec(line);
		if (!match?.[1]) continue;
		let value = match[2] ?? "";
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		entries.push({ key: match[1], value });
	}
	return entries;
}

export function isEnvLikePatch(patch: string | null | undefined): boolean {
	if (!patch?.trim()) return false;
	return extractEnvEntries(patch).length > 0;
}

/** Merge patch entries into an existing dotenv string (patch wins on key clash). */
export function mergeDotenv(existing: string | null | undefined, patch: string): string {
	const entries = extractEnvEntries(patch);
	if (entries.length === 0) {
		throw badRequest("Suggested patch has no KEY=VALUE environment lines to apply");
	}
	const map = new Map<string, string>();
	for (const raw of (existing ?? "").split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = ENV_LINE.exec(line);
		if (match?.[1]) map.set(match[1], match[2] ?? "");
	}
	for (const entry of entries) {
		map.set(entry.key, entry.value);
	}
	return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("\n");
}
