import { z } from "zod";

/**
 * Coercion of flattened GET query parameters for the REST adapter
 * (apps/web/src/app/api/[...rest]/route.ts).
 *
 * Query strings only carry strings, but tRPC inputs use `z.number()` /
 * `z.boolean()` for limits, ports and flags. Coercion is driven by the
 * procedure's own Zod input schema (introspected through the same JSON-schema
 * conversion `openapi.ts` uses): a field is converted only when its schema
 * accepts a number/boolean and NOT a string, so `z.string()` inputs such as
 * `?search=2024` or `?environmentName=1` stay strings.
 */

type JsonSchema = Record<string, unknown>;

/** Primitive JSON types a property's schema accepts (from `type`, `anyOf`, `enum`, `const`). */
function acceptedTypes(schema: JsonSchema | undefined, into = new Set<string>()): Set<string> {
	if (!schema) return into;
	const type = schema.type;
	if (typeof type === "string") into.add(type);
	else if (Array.isArray(type)) for (const entry of type) into.add(String(entry));
	for (const key of ["anyOf", "oneOf", "allOf"] as const) {
		const variants = schema[key];
		if (Array.isArray(variants)) {
			for (const variant of variants) acceptedTypes(variant as JsonSchema, into);
		}
	}
	if ("const" in schema) into.add(jsonTypeOf(schema.const));
	if (Array.isArray(schema.enum)) for (const value of schema.enum) into.add(jsonTypeOf(value));
	return into;
}

function jsonTypeOf(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
	return typeof value;
}

/** Map of top-level input property → accepted JSON types, or null when unknown. */
export function inputPropertyTypes(inputSchema: unknown): Map<string, Set<string>> | null {
	if (!inputSchema) return null;
	let json: JsonSchema;
	try {
		json = z.toJSONSchema(inputSchema as z.ZodType, { io: "input" }) as JsonSchema;
	} catch {
		return null;
	}
	const properties = json.properties;
	if (json.type !== "object" || typeof properties !== "object" || properties === null) {
		return null;
	}
	const out = new Map<string, Set<string>>();
	for (const [name, property] of Object.entries(properties as Record<string, JsonSchema>)) {
		out.set(name, acceptedTypes(property));
	}
	return out;
}

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Coerce flattened query params against the procedure's input schema. Fields
 * the schema does not describe (or that accept strings) are left untouched;
 * a missing schema means no coercion at all.
 */
export function coerceQueryInput(
	params: Record<string, string>,
	inputSchema: unknown,
): Record<string, unknown> {
	const types = inputPropertyTypes(inputSchema);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		const accepted = types?.get(key);
		out[key] = accepted ? coerceValue(value, accepted) : value;
	}
	return out;
}

function coerceValue(value: string, accepted: Set<string>): unknown {
	if (accepted.has("string")) return value;
	if (accepted.has("boolean") && (value === "true" || value === "false")) {
		return value === "true";
	}
	if ((accepted.has("number") || accepted.has("integer")) && NUMBER_PATTERN.test(value)) {
		return Number(value);
	}
	if (accepted.has("null") && value === "null") return null;
	return value;
}
