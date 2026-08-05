import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { environments, organizations, projects } from "../../db/schema";

/**
 * Environment-variable resolution.
 *
 * Env vars are stored as dotenv-formatted strings (encrypted at rest) on three
 * levels and inherit downward, with the deeper level winning on key conflicts:
 *
 *   organization (metadata.env) → project.env → environment.env
 *
 * Service-level env (application/compose/database rows) is merged on top of
 * this result by the owning service module.
 */

const KEY_PATTERN = /^[\w.-]+$/;

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
	const result: Record<string, string> = {};
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

/**
 * Organization-level env vars live in `organization.metadata` as a JSON object
 * with an `env` dotenv string (better-auth's organization table has no
 * dedicated env column). Missing/malformed metadata simply yields no vars.
 */
function parseOrganizationEnv(metadata: string | null): Record<string, string> {
	if (!metadata) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(metadata);
		if (parsed && typeof parsed === "object" && "env" in parsed) {
			const env = (parsed as { env?: unknown }).env;
			if (typeof env === "string") {
				return parseEnv(env);
			}
		}
	} catch {
		// fall through — malformed metadata means no org-level env
	}
	return {};
}

/**
 * Resolve the effective env vars for an environment by merging
 * organization → project → environment levels (later level wins).
 *
 * NOTE: no organization check here on purpose — this is an internal helper for
 * trusted server-side callers (deploy pipeline, compose runner). Routers must
 * authorize before calling it.
 *
 * @throws TRPCError NOT_FOUND when the environment does not exist.
 */
export async function resolveEnvironmentVariables(
	environmentId: string,
): Promise<Record<string, string>> {
	const [row] = await db
		.select({
			environmentEnv: environments.env,
			projectEnv: projects.env,
			organizationMetadata: organizations.metadata,
		})
		.from(environments)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.innerJoin(organizations, eq(projects.organizationId, organizations.id))
		.where(eq(environments.environmentId, environmentId))
		.limit(1);

	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Environment ${environmentId} not found`,
		});
	}

	let merged = parseOrganizationEnv(row.organizationMetadata);
	merged = mergeEnv(merged, parseEnv(row.projectEnv));
	merged = mergeEnv(merged, parseEnv(row.environmentEnv));
	return merged;
}
