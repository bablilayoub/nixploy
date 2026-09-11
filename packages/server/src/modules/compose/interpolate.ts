import { parseEnv } from "../deployment/env";
import { badRequest } from "../errors";
import type { ComposeEnv, ComposeFileSpec } from "./parse";

/**
 * Env merging and compose-go style interpolation: turning the stored file plus
 * the merged project → environment → service env into the spec Docker will
 * actually run. `renderComposeSpec` is what the safety pass must see.
 */

const VAR_NAME_RE = /^[_a-zA-Z][_a-zA-Z0-9]*/;

/**
 * Expand one string the way compose does (compose-go template grammar):
 * `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `${VAR:?err}`,
 * `${VAR?err}`, `${VAR:+alt}`, `${VAR+alt}`, nested `${A:-${B}}`, and `$$`
 * as a literal dollar. Unknown variables expand to the empty string, exactly
 * like `docker compose` does when a variable is unset.
 */
export function interpolateComposeString(input: string, env: ComposeEnv): string {
	let out = "";
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (ch !== "$") {
			out += ch;
			i += 1;
			continue;
		}
		const next = input[i + 1];
		if (next === "$") {
			out += "$";
			i += 2;
			continue;
		}
		if (next === "{") {
			let depth = 1;
			let j = i + 2;
			while (j < input.length && depth > 0) {
				if (input[j] === "{") depth += 1;
				else if (input[j] === "}") depth -= 1;
				if (depth > 0) j += 1;
			}
			if (depth !== 0) {
				throw badRequest(`Invalid compose interpolation (unterminated \${): "${input}"`);
			}
			out += expandBraced(input.slice(i + 2, j), env, input);
			i = j + 1;
			continue;
		}
		const named = VAR_NAME_RE.exec(input.slice(i + 1));
		if (named) {
			out += env[named[0]] ?? "";
			i += 1 + named[0].length;
			continue;
		}
		// A `$` followed by anything else is not a template — keep it.
		out += "$";
		i += 1;
	}
	return out;
}

function expandBraced(inner: string, env: ComposeEnv, whole: string): string {
	const named = VAR_NAME_RE.exec(inner);
	if (!named) {
		throw badRequest(`Invalid compose interpolation format: "${whole}"`);
	}
	const name = named[0];
	const rest = inner.slice(name.length);
	const value = env[name];
	if (rest === "") return value ?? "";
	const two = rest.slice(0, 2);
	const one = rest.slice(0, 1);
	const op =
		two === ":-" || two === ":?" || two === ":+"
			? two
			: one === "-" || one === "?" || one === "+"
				? one
				: null;
	if (!op) {
		throw badRequest(`Invalid compose interpolation format: "${whole}"`);
	}
	const arg = rest.slice(op.length);
	// `:` variants treat an empty value like an unset one.
	const missing = op.startsWith(":") ? value === undefined || value === "" : value === undefined;
	switch (op) {
		case ":-":
		case "-":
			return missing ? interpolateComposeString(arg, env) : (value as string);
		case ":?":
		case "?":
			if (!missing) return value as string;
			throw badRequest(
				`Required compose variable ${name} is missing a value: ${interpolateComposeString(arg, env)}`,
			);
		default:
			return missing ? "" : interpolateComposeString(arg, env);
	}
}

function mapStrings(value: unknown, fn: (text: string) => string): unknown {
	if (typeof value === "string") return fn(value);
	if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			out[key] = mapStrings(entry, fn);
		}
		return out;
	}
	return value;
}

/**
 * Resolve `environment` entries without a value (`- KEY` / `KEY:` null) from
 * the merged env, dropping the ones it does not define. Compose would fall
 * back to the *panel's* process environment for those — never allow that.
 */
function resolveBareEnvironment(environment: unknown, env: ComposeEnv): unknown {
	if (Array.isArray(environment)) {
		const out: unknown[] = [];
		for (const entry of environment) {
			if (typeof entry !== "string" || entry.includes("=")) {
				out.push(entry);
				continue;
			}
			const key = entry.trim();
			if (key in env) out.push(`${key}=${env[key]}`);
		}
		return out;
	}
	if (environment && typeof environment === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(environment as Record<string, unknown>)) {
			if (value === null || value === undefined) {
				if (key in env) out[key] = env[key];
				continue;
			}
			out[key] = value;
		}
		return out;
	}
	return environment;
}

/**
 * Interpolate every string of the parsed spec with the merged env — this is
 * the spec Docker will actually run, so it is what the safety check must see.
 * Returns a deep copy; the input is left untouched.
 */
export function renderComposeSpec(spec: ComposeFileSpec, env: ComposeEnv): ComposeFileSpec {
	const rendered = mapStrings(spec, (text) =>
		interpolateComposeString(text, env),
	) as ComposeFileSpec;
	for (const service of Object.values(rendered.services ?? {})) {
		if (service.environment !== undefined) {
			service.environment = resolveBareEnvironment(service.environment, env);
		}
	}
	return rendered;
}

/**
 * Escape every `$` as `$$` so the already-rendered file survives Docker's own
 * interpolation pass unchanged (compose and the stack loader both un-escape
 * `$$`). Nothing in the deployed file is ever resolved from the host env.
 */
export function escapeComposeInterpolation(spec: ComposeFileSpec): ComposeFileSpec {
	// Function replacer: a "$$" replacement string would itself mean a literal "$".
	return mapStrings(spec, (text) => text.replaceAll("$", () => "$$")) as ComposeFileSpec;
}

/**
 * Value the container should see for one `KEY=VALUE` env line. Surrounding
 * matching quotes are stripped (what `docker compose --env-file` used to do
 * for these files); nothing else is interpreted.
 */
function unquoteEnvValue(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

/** Merged `KEY=VALUE` lines → interpolation map. */
export function composeEnvMap(mergedEnv: string | null | undefined): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of parseEnv(mergedEnv)) env[key] = unquoteEnvValue(value);
	return env;
}

/**
 * Whether an env value is worth registering as a log secret. Short tokens
 * (`DEBUG=1`, `POSTGRES_USER=postgres`, ports, booleans) would redact every
 * occurrence of "1" / "postgres" in the deploy log and make it unreadable.
 */
export function shouldRedactEnvValue(value: string): boolean {
	const trimmed = value.trim();
	if (trimmed.length < 8) return false;
	if (/^\d+$/.test(trimmed)) return false;
	if (/^(true|false|yes|no|on|off|null|undefined)$/i.test(trimmed)) return false;
	return true;
}

/**
 * Merge `KEY=VALUE` env files, later sources overriding earlier ones
 * (project → environment → service). Comments and blank lines are dropped.
 */
export function mergeEnvVars(...sources: Array<string | null | undefined>): string {
	const byKey = new Map<string, string>();
	for (const source of sources) {
		if (!source) continue;
		for (const line of source.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			byKey.set(trimmed.slice(0, eq).trim(), trimmed);
		}
	}
	return [...byKey.values()].join("\n");
}
