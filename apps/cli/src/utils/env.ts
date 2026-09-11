import { usageError } from "../errors.js";

/**
 * `.env` blob helpers. Nixploy stores environment variables as one text blob
 * per scope (org → project → environment → service); the CLI parses it only
 * to merge `KEY=VALUE` pairs and to report a diff, never to re-order or
 * re-quote what the user wrote.
 */

export type EnvMap = Record<string, string>;

/** Parse `KEY=VALUE` CLI arguments. */
export function parsePairs(pairs: string[]): EnvMap {
	const result: EnvMap = {};
	for (const pair of pairs) {
		const index = pair.indexOf("=");
		if (index <= 0) {
			throw usageError(`Invalid KEY=VALUE pair: "${pair}"`);
		}
		result[pair.slice(0, index)] = pair.slice(index + 1);
	}
	return result;
}

/** Parse a `.env` blob. Comments and blank lines are dropped. */
export function deserializeEnv(env: string): EnvMap {
	const result: EnvMap = {};
	for (const line of env.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) {
			continue;
		}
		const index = trimmed.indexOf("=");
		if (index > 0) {
			result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
		}
	}
	return result;
}

export function serializeEnv(env: EnvMap): string {
	return Object.entries(env)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

export interface EnvDiff {
	added: string[];
	changed: string[];
	removed: string[];
	unchanged: string[];
}

/** Key-level diff. Values never appear in the summary — only key names. */
export function diffEnv(before: EnvMap, after: EnvMap): EnvDiff {
	const added: string[] = [];
	const changed: string[] = [];
	const unchanged: string[] = [];
	for (const [key, value] of Object.entries(after)) {
		if (!(key in before)) added.push(key);
		else if (before[key] !== value) changed.push(key);
		else unchanged.push(key);
	}
	const removed = Object.keys(before).filter((key) => !(key in after));
	return {
		added: added.sort(),
		changed: changed.sort(),
		removed: removed.sort(),
		unchanged: unchanged.sort(),
	};
}

export function describeDiff(diff: EnvDiff): string {
	const parts: string[] = [];
	if (diff.added.length) parts.push(`+${diff.added.length} added (${diff.added.join(", ")})`);
	if (diff.changed.length)
		parts.push(`~${diff.changed.length} changed (${diff.changed.join(", ")})`);
	if (diff.removed.length)
		parts.push(`-${diff.removed.length} removed (${diff.removed.join(", ")})`);
	return parts.length > 0 ? parts.join(", ") : "no changes";
}
