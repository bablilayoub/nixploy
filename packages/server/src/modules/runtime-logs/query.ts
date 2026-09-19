import { LOG_LINE_LEVELS, type LogLineLevel } from "../observability/log-levels";
import type { RuntimeLogLine } from "./format";

/**
 * The search grammar, small on purpose:
 *
 *   error timeout          every term must appear (case-insensitive substring)
 *   "connection refused"   a phrase, matched as one term
 *   -healthcheck           the line must NOT contain the term
 *   level:error,warn       one of these levels (`level:` may repeat)
 *   container:web          the compose/stack service name (`service:` is an alias)
 *   /re(gex)?/i            a JavaScript regular expression, ≤ 200 chars
 *
 * Bounded by construction: a regex is length-capped and refused when it
 * quantifies a group (`(a+)+` is the classic catastrophic shape), and the
 * reader that applies the query has its own line and time budget.
 */
export interface LogQuery {
	terms: string[];
	excludes: string[];
	levels: Set<LogLineLevel> | null;
	containers: Set<string> | null;
	regex: RegExp | null;
}

export class LogQueryError extends Error {}

export const MAX_QUERY_LENGTH = 500;
export const MAX_REGEX_LENGTH = 200;

/** Quantified group — `(…)+`, `(…)*`, `(…){n,}` — the shape behind catastrophic backtracking. */
const QUANTIFIED_GROUP_RE = /\)[+*{]/;

const tokenize = (text: string): string[] => {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		if (quote) {
			if (quote === "/" && char === "\\") {
				// An escaped character inside a regex (`\/`, `\d`) is copied verbatim.
				current += char + (text[index + 1] ?? "");
				index += 1;
				continue;
			}
			if (char === quote) {
				// The closing `/` stays in the token so the flags can be split off it.
				if (quote === "/") current += "/";
				quote = null;
				continue;
			}
			current += char;
			continue;
		}
		if (char === '"' || (char === "/" && (current === "" || current === "-"))) {
			quote = char === "/" ? "/" : '"';
			current += char === "/" ? "/" : "";
			continue;
		}
		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (quote === '"') throw new LogQueryError("Unterminated quote in the query");
	if (quote === "/") throw new LogQueryError("Unterminated regular expression in the query");
	if (current) tokens.push(current);
	return tokens;
};

export function parseLogQuery(text: string): LogQuery {
	if (text.length > MAX_QUERY_LENGTH) throw new LogQueryError("Query is too long");
	const query: LogQuery = { terms: [], excludes: [], levels: null, containers: null, regex: null };
	for (const token of tokenize(text.trim())) {
		if (token.startsWith("/")) {
			// The tokenizer kept both slashes; flags are what follows the closing one.
			const body = token.slice(1);
			const close = body.lastIndexOf("/");
			const source = close >= 0 ? body.slice(0, close) : body;
			const flags = close >= 0 ? body.slice(close + 1) : "";
			if (/[^gimsuy]/.test(flags)) throw new LogQueryError(`Unknown regex flags "${flags}"`);
			if (!source) throw new LogQueryError("Empty regular expression");
			if (source.length > MAX_REGEX_LENGTH) {
				throw new LogQueryError(`Regular expression longer than ${MAX_REGEX_LENGTH} characters`);
			}
			if (QUANTIFIED_GROUP_RE.test(source)) {
				throw new LogQueryError("A quantified group ((…)+ or (…)*) is not allowed in a log search");
			}
			try {
				query.regex = new RegExp(source, flags.includes("i") ? "i" : "");
			} catch (error) {
				throw new LogQueryError(
					`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			continue;
		}
		const lower = token.toLowerCase();
		if (lower.startsWith("level:")) {
			const wanted = token
				.slice(6)
				.split(",")
				.map((value) => value.trim().toLowerCase())
				.filter(Boolean);
			for (const value of wanted) {
				if (!(LOG_LINE_LEVELS as readonly string[]).includes(value)) {
					throw new LogQueryError(
						`Unknown level "${value}" (one of ${LOG_LINE_LEVELS.join(", ")})`,
					);
				}
				query.levels ??= new Set();
				query.levels.add(value as LogLineLevel);
			}
			continue;
		}
		if (lower.startsWith("container:") || lower.startsWith("service:")) {
			const value = token.slice(token.indexOf(":") + 1).trim();
			if (value) {
				query.containers ??= new Set();
				query.containers.add(value.toLowerCase());
			}
			continue;
		}
		if (token.startsWith("-") && token.length > 1) {
			query.excludes.push(token.slice(1).toLowerCase());
			continue;
		}
		if (token) query.terms.push(token.toLowerCase());
	}
	return query;
}

export const isEmptyQuery = (query: LogQuery): boolean =>
	query.terms.length === 0 &&
	query.excludes.length === 0 &&
	!query.levels &&
	!query.containers &&
	!query.regex;

export function matchLogLine(query: LogQuery, line: RuntimeLogLine): boolean {
	if (query.levels && !query.levels.has(line.level)) return false;
	if (query.containers && !query.containers.has((line.container ?? "").toLowerCase())) return false;
	const haystack = line.message.toLowerCase();
	for (const term of query.terms) {
		if (!haystack.includes(term)) return false;
	}
	for (const term of query.excludes) {
		if (haystack.includes(term)) return false;
	}
	if (query.regex && !query.regex.test(line.message)) return false;
	return true;
}
