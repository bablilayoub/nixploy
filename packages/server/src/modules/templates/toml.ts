/**
 * A TOML reader for template blueprints — the subset those files actually
 * use, nothing more: comments, `[tables]`, `[[arrays of tables]]`, dotted
 * table headers, `key = value` with basic / literal / multi-line strings,
 * integers (with `_` separators), floats, booleans, and arrays of scalars
 * across lines with trailing commas. Inline tables, dates and dotted keys
 * inside a table are refused with a clear error instead of misread.
 *
 * Hand-written because the workspace dependency set is fixed and the
 * blueprint format is small; a full TOML 1.0 parser would be more code than
 * this file for no template that exists.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
	[key: string]: TomlValue;
}

export class TomlError extends Error {
	constructor(
		message: string,
		public readonly line: number,
	) {
		super(`TOML line ${line}: ${message}`);
		this.name = "TomlError";
	}
}

const isObject = (value: TomlValue | undefined): value is TomlTable =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Split a header like `config.domains` or `"a b".c` into its parts. */
function splitKeyPath(raw: string, line: number): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (let index = 0; index < raw.length; index += 1) {
		const char = raw[index] ?? "";
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === ".") {
			if (!current.trim()) throw new TomlError("empty key segment", line);
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	if (quote) throw new TomlError("unterminated quoted key", line);
	if (!current.trim()) throw new TomlError("empty key", line);
	parts.push(current.trim());
	return parts;
}

const unescapeBasic = (value: string): string =>
	value.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, code: string) => {
		switch (code[0]) {
			case "n":
				return "\n";
			case "t":
				return "\t";
			case "r":
				return "\r";
			case '"':
				return '"';
			case "\\":
				return "\\";
			case "b":
				return "\b";
			case "f":
				return "\f";
			case "u":
			case "U":
				return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
			default:
				// Not TOML, but real blueprints carry `\$` inside shell snippets;
				// the file's own parser tolerates it, so keep both characters.
				return `\\${code}`;
		}
	});

interface Cursor {
	lines: string[];
	index: number;
}

/**
 * Parse one value starting at `text` (the remainder of the current line after
 * `=`). Multi-line strings and arrays consume following lines through the
 * cursor. Returns the value and whatever trailed it on the last line.
 */
function parseValue(text: string, cursor: Cursor): { value: TomlValue; rest: string } {
	const line = cursor.index + 1;
	const trimmed = text.trimStart();

	if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
		const delimiter = trimmed.slice(0, 3);
		const literal = delimiter === "'''";
		let body = trimmed.slice(3);
		// A newline right after the opening delimiter is trimmed (TOML rule).
		let collected = "";
		let first = true;
		for (;;) {
			const end = body.indexOf(delimiter);
			if (end !== -1) {
				collected += body.slice(0, end);
				const rest = body.slice(end + 3);
				return { value: literal ? collected : unescapeBasic(collected), rest };
			}
			collected += first && body === "" ? "" : `${body}\n`;
			first = false;
			cursor.index += 1;
			const next = cursor.lines[cursor.index];
			if (next === undefined) throw new TomlError("unterminated multi-line string", line);
			body = next;
		}
	}
	if (trimmed.startsWith('"')) {
		let index = 1;
		let out = "";
		while (index < trimmed.length) {
			const char = trimmed[index] ?? "";
			if (char === "\\") {
				out += char + (trimmed[index + 1] ?? "");
				index += 2;
				continue;
			}
			if (char === '"') {
				return { value: unescapeBasic(out), rest: trimmed.slice(index + 1) };
			}
			out += char;
			index += 1;
		}
		throw new TomlError("unterminated string", line);
	}
	if (trimmed.startsWith("'")) {
		const end = trimmed.indexOf("'", 1);
		if (end === -1) throw new TomlError("unterminated literal string", line);
		return { value: trimmed.slice(1, end), rest: trimmed.slice(end + 1) };
	}
	if (trimmed.startsWith("[")) {
		const items: TomlValue[] = [];
		let body = trimmed.slice(1);
		for (;;) {
			body = body.replace(/^\s+/, "");
			if (body.startsWith("#") || body === "") {
				cursor.index += 1;
				const next = cursor.lines[cursor.index];
				if (next === undefined) throw new TomlError("unterminated array", line);
				body = next;
				continue;
			}
			if (body.startsWith("]")) return { value: items, rest: body.slice(1) };
			if (body.startsWith(",")) {
				body = body.slice(1);
				continue;
			}
			const parsed = parseValue(body, cursor);
			items.push(parsed.value);
			body = parsed.rest;
		}
	}
	if (trimmed.startsWith("{")) {
		// Inline table: `{ a = 1, b = "x" }`, nested inline tables allowed,
		// always on one line (TOML forbids newlines inside one).
		const table: TomlTable = {};
		let body = trimmed.slice(1);
		for (;;) {
			body = body.replace(/^\s+/, "");
			if (body.startsWith("}")) return { value: table, rest: body.slice(1) };
			if (body.startsWith(",")) {
				body = body.slice(1);
				continue;
			}
			const equals = body.indexOf("=");
			if (equals === -1) throw new TomlError("unterminated inline table", line);
			const keyRaw = body.slice(0, equals).trim();
			const quoted = /^"(.*)"$|^'(.*)'$/.exec(keyRaw);
			const name = quoted ? (quoted[1] ?? quoted[2] ?? "") : keyRaw;
			if (!quoted && !/^[A-Za-z0-9_-]+$/.test(name)) {
				throw new TomlError(`unsupported inline key "${keyRaw}"`, line);
			}
			const parsed = parseValue(body.slice(equals + 1), cursor);
			table[name] = parsed.value;
			body = parsed.rest;
		}
	}
	const scalar = /^([^\s,\]#]+)/.exec(trimmed);
	if (!scalar?.[1]) throw new TomlError("expected a value", line);
	const token = scalar[1];
	const rest = trimmed.slice(token.length);
	if (token === "true") return { value: true, rest };
	if (token === "false") return { value: false, rest };
	const numeric = token.replace(/_/g, "");
	if (/^[+-]?\d+$/.test(numeric)) return { value: Number.parseInt(numeric, 10), rest };
	if (/^[+-]?\d+\.\d+([eE][+-]?\d+)?$/.test(numeric))
		return { value: Number.parseFloat(numeric), rest };
	throw new TomlError(`unsupported value "${token}"`, line);
}

const assertTrailing = (rest: string, line: number): void => {
	const trailing = rest.trim();
	if (trailing !== "" && !trailing.startsWith("#")) {
		throw new TomlError(`unexpected "${trailing.slice(0, 20)}" after value`, line);
	}
};

/** Walk/create nested tables for a header path; the last segment may be an array of tables. */
function tableAt(root: TomlTable, path: string[], line: number, arrayTable: boolean): TomlTable {
	let current: TomlTable = root;
	for (let depth = 0; depth < path.length; depth += 1) {
		const key = path[depth] ?? "";
		const last = depth === path.length - 1;
		const existing = current[key];
		if (last && arrayTable) {
			const list = Array.isArray(existing) ? existing : [];
			if (existing !== undefined && !Array.isArray(existing)) {
				throw new TomlError(`"${key}" is not an array of tables`, line);
			}
			const entry: TomlTable = {};
			list.push(entry);
			current[key] = list;
			return entry;
		}
		if (existing === undefined) {
			const created: TomlTable = {};
			current[key] = created;
			current = created;
		} else if (Array.isArray(existing)) {
			// `[[a]]` followed by `[a.b]` targets the newest array entry.
			const newest = existing[existing.length - 1];
			if (!isObject(newest)) throw new TomlError(`"${key}" holds scalars`, line);
			current = newest;
		} else if (isObject(existing)) {
			current = existing;
		} else {
			throw new TomlError(`"${key}" is a value, not a table`, line);
		}
	}
	return current;
}

export function parseToml(source: string): TomlTable {
	const root: TomlTable = {};
	const cursor: Cursor = { lines: source.split(/\r?\n/), index: 0 };
	let current: TomlTable = root;

	for (; cursor.index < cursor.lines.length; cursor.index += 1) {
		const raw = cursor.lines[cursor.index] ?? "";
		const line = cursor.index + 1;
		const text = raw.trim();
		if (text === "" || text.startsWith("#")) continue;

		if (text.startsWith("[[")) {
			const end = text.indexOf("]]");
			if (end === -1) throw new TomlError("unterminated table header", line);
			assertTrailing(text.slice(end + 2), line);
			current = tableAt(root, splitKeyPath(text.slice(2, end), line), line, true);
			continue;
		}
		if (text.startsWith("[")) {
			const end = text.indexOf("]");
			if (end === -1) throw new TomlError("unterminated table header", line);
			assertTrailing(text.slice(end + 1), line);
			current = tableAt(root, splitKeyPath(text.slice(1, end), line), line, false);
			continue;
		}

		const equals = text.indexOf("=");
		if (equals === -1) throw new TomlError("expected key = value", line);
		const keyRaw = text.slice(0, equals).trim();
		const key = /^"(.*)"$|^'(.*)'$/.exec(keyRaw);
		const name = key ? (key[1] ?? key[2] ?? "") : keyRaw;
		if (!key && !/^[A-Za-z0-9_-]+$/.test(name)) {
			throw new TomlError(`unsupported key "${keyRaw}"`, line);
		}
		if (name in current) throw new TomlError(`duplicate key "${name}"`, line);
		const { value, rest } = parseValue(text.slice(equals + 1), cursor);
		assertTrailing(rest, cursor.index + 1);
		current[name] = value;
	}
	return root;
}
