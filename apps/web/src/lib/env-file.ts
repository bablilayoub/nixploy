/**
 * Minimal dotenv reader/writer for the env editor's import/export buttons.
 * Mirrors what the server accepts (`modules/projects/env-resolution.ts`):
 * one `KEY=VALUE` per line, `#` comments, optional `export ` prefix, single
 * or double quotes (double quotes unescape `\n`, `\"` and `\\`).
 */

export interface EnvEntry {
	key: string;
	value: string;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function unquote(raw: string): string {
	const value = raw.trim();
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value
			.slice(1, -1)
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "\r")
			.replace(/\\t/g, "\t")
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\");
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1);
	}
	// Unquoted: an inline ` # comment` ends the value.
	const hash = value.search(/\s#/);
	return (hash >= 0 ? value.slice(0, hash) : value).trim();
}

/** Parse dotenv text into ordered entries; later duplicates win. */
export function parseEnvFile(text: string): EnvEntry[] {
	const entries = new Map<string, string>();
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
		const eq = withoutExport.indexOf("=");
		if (eq <= 0) continue;
		const key = withoutExport.slice(0, eq).trim();
		if (!KEY_PATTERN.test(key)) continue;
		entries.set(key, unquote(withoutExport.slice(eq + 1)));
	}
	return [...entries.entries()].map(([key, value]) => ({ key, value }));
}

/** Quote a value only when the plain form would not round-trip. */
export function formatEnvValue(value: string): string {
	if (value === "" || /[\s#"'\\$`]/.test(value)) {
		const escaped = value
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "\\r")
			.replace(/\t/g, "\\t");
		return `"${escaped}"`;
	}
	return value;
}

/**
 * Merge imported entries into an existing dotenv draft: lines whose key is
 * imported are replaced in place (comments and unrelated lines are kept),
 * new keys are appended. Returns the draft unchanged when nothing changes.
 */
export function mergeEnvText(draft: string, imported: EnvEntry[]): string {
	if (imported.length === 0) return draft;
	const pending = new Map(imported.map((entry) => [entry.key, entry.value]));
	const lines = draft.split(/\r?\n/);
	const merged = lines.map((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) return line;
		const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
		const eq = body.indexOf("=");
		if (eq <= 0) return line;
		const key = body.slice(0, eq).trim();
		const value = pending.get(key);
		if (value === undefined) return line;
		pending.delete(key);
		return `${key}=${formatEnvValue(value)}`;
	});
	// Drop a single trailing blank line before appending so keys stay contiguous.
	while (merged.length > 0 && merged[merged.length - 1]?.trim() === "") merged.pop();
	for (const [key, value] of pending) {
		merged.push(`${key}=${formatEnvValue(value)}`);
	}
	return merged.join("\n");
}

/** Serialize entries back into dotenv text (one `KEY=VALUE` per line). */
export function serializeEnvEntries(entries: EnvEntry[]): string {
	return entries.map((entry) => `${entry.key}=${formatEnvValue(entry.value)}`).join("\n");
}
