const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
	n: "\n",
	r: "\r",
	t: "\t",
	'"': '"',
	"\\": "\\",
	$: "$",
	"`": "`",
};

/**
 * Parse a dotenv-formatted string into a key/value map.
 * Supports comments (`#`), `export ` prefixes, single/double-quoted values,
 * escape sequences inside double quotes, and inline comments on unquoted
 * values. Malformed lines are skipped.
 */
export function parseEnv(input: string | null | undefined): Record<string, string> {
	const result: Record<string, string> = Object.create(null);
	if (!input) {
		return result;
	}
	for (const rawLine of input.split(/\r?\n/)) {
		let line = rawLine.trim();
		if (!line || line.startsWith("#")) {
			continue;
		}
		if (line.startsWith("export ")) {
			line = line.slice("export ".length).trimStart();
		}
		const equalsIndex = line.indexOf("=");
		let key: string;
		let value: string;
		if (equalsIndex === -1) {
			key = line.trim();
			value = "";
		} else {
			key = line.slice(0, equalsIndex).trim();
			value = line.slice(equalsIndex + 1).trim();
		}
		if (!key || !KEY_PATTERN.test(key)) {
			continue;
		}
		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
			value = value
				.slice(1, -1)
				.replace(/\\(.)/g, (_, char: string) => DOUBLE_QUOTE_ESCAPES[char] ?? char);
		} else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		} else {
			// Unquoted: strip inline comments (`KEY=value # comment`).
			const commentIndex = value.indexOf(" #");
			if (commentIndex !== -1) {
				value = value.slice(0, commentIndex).trimEnd();
			}
		}
		result[key] = value;
	}
	return result;
}

/**
 * Merge two parsed env maps; keys in `override` win over `base`.
 * Empty-string values are legitimate overrides (they unset a base value).
 */
export function mergeEnv(
	base: Record<string, string>,
	override: Record<string, string>,
): Record<string, string> {
	return { ...base, ...override };
}

/** Merge two dotenv-formatted strings; keys in `override` win. */
export function mergeEnvStrings(
	base: string | null | undefined,
	override: string | null | undefined,
): Record<string, string> {
	return mergeEnv(parseEnv(base), parseEnv(override));
}

/** Serialize an env map back to a dotenv-formatted string. */
export function toEnvString(vars: Record<string, string>): string {
	return Object.entries(vars)
		.map(([key, value]) => {
			if (value === "" || /[\s#"'\\$`]/.test(value)) {
				const escaped = value
					.replace(/\\/g, "\\\\")
					.replace(/"/g, '\\"')
					.replace(/\n/g, "\\n")
					.replace(/\r/g, "\\r")
					.replace(/\t/g, "\\t");
				return `${key}="${escaped}"`;
			}
			return `${key}=${value}`;
		})
		.join("\n");
}
