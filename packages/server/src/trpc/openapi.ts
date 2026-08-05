import { z } from "zod";
import { appRouter } from "./root";

/**
 * Mechanical OpenAPI 3 generation from the tRPC appRouter. Every procedure
 * becomes a REST endpoint mirroring the catch-all handler in the web app
 * (apps/web/src/app/api/[...rest]/route.ts):
 *
 *   queries   → GET  /api/<router>.<procedure>  (input via query params,
 *               or a URL-encoded JSON `input` param for complex payloads)
 *   mutations → POST /api/<router>.<procedure>  (input as the JSON body)
 *
 * Authentication is the `x-api-key` header (better-auth api-key plugin).
 */

interface OpenApiOperation {
	tags: string[];
	summary: string;
	operationId: string;
	security: Array<Record<string, string[]>>;
	parameters?: unknown[];
	requestBody?: unknown;
	responses: Record<string, unknown>;
}

type JsonSchema = Record<string, unknown>;

const GENERIC_INPUT_SCHEMA: JsonSchema = {
	type: "object",
	additionalProperties: true,
};

function inputJsonSchema(procedureDef: { inputs?: unknown[] }): JsonSchema | null {
	const parser = procedureDef.inputs?.[0];
	if (!parser) return null;
	try {
		// tRPC stores the raw zod schema as the first input parser.
		const schema = z.toJSONSchema(parser as z.ZodType, { io: "input" });
		const { $schema: _ignored, ...rest } = schema as Record<string, unknown>;
		return rest as JsonSchema;
	} catch {
		return GENERIC_INPUT_SCHEMA;
	}
}

function queryParameters(schema: JsonSchema | null): unknown[] {
	const parameters: unknown[] = [
		{
			name: "input",
			in: "query",
			required: false,
			description:
				"Full procedure input as URL-encoded JSON. Overrides the flattened parameters below.",
			schema: { type: "string" },
		},
	];
	if (schema?.type === "object" && schema.properties) {
		const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
		for (const [name, propSchema] of Object.entries(
			schema.properties as Record<string, JsonSchema>,
		)) {
			const type = typeof propSchema.type === "string" ? propSchema.type : "string";
			parameters.push({
				name,
				in: "query",
				required: required.has(name),
				schema:
					type === "string" || type === "number" || type === "integer" || type === "boolean"
						? { type }
						: { type: "string", description: "JSON-encoded value" },
			});
		}
	}
	return parameters;
}

const RESPONSES: Record<string, unknown> = {
	"200": {
		description: "tRPC-style success envelope",
		content: {
			"application/json": {
				schema: {
					type: "object",
					properties: { result: { type: "object" } },
				},
			},
		},
	},
	"400": { description: "Invalid input" },
	"401": { description: "Missing or invalid API key" },
	"404": { description: "Unknown procedure" },
	"500": { description: "Internal server error" },
};

export interface OpenApiOptions {
	title?: string;
	version?: string;
	serverUrl?: string;
}

export function generateOpenApiDocument(options: OpenApiOptions = {}) {
	const paths: Record<string, Record<string, OpenApiOperation>> = {};

	const walk = (procedures: Record<string, unknown>, prefix: string) => {
		for (const [key, value] of Object.entries(procedures)) {
			const def = (value as { _def?: Record<string, unknown> })._def;
			if (!def) continue;
			if (def.procedures) {
				// Nested router.
				walk(def.procedures as Record<string, unknown>, prefix ? `${prefix}.${key}` : key);
				continue;
			}
			const type = def.type as string;
			if (type !== "query" && type !== "mutation") continue;

			const path = prefix ? `${prefix}.${key}` : key;
			const tag = path.split(".")[0] ?? "default";
			const inputSchema = inputJsonSchema(def as { inputs?: unknown[] });

			const operation: OpenApiOperation = {
				tags: [tag],
				summary: path,
				operationId: path,
				security: [{ apiKey: [] }],
				responses: RESPONSES,
			};

			if (type === "query") {
				operation.parameters = queryParameters(inputSchema);
				paths[`/api/${path}`] = { get: operation };
			} else {
				operation.requestBody = {
					required: inputSchema !== null,
					content: {
						"application/json": {
							schema: inputSchema ?? GENERIC_INPUT_SCHEMA,
						},
					},
				};
				paths[`/api/${path}`] = { post: operation };
			}
		}
	};

	walk(appRouter._def.procedures as Record<string, unknown>, "");

	const tags = [
		...new Set(
			Object.values(paths).flatMap((methods) => Object.values(methods).flatMap((op) => op.tags)),
		),
	]
		.sort()
		.map((name) => ({ name }));

	return {
		openapi: "3.0.3",
		info: {
			title: options.title ?? "Nixploy API",
			version: options.version ?? "0.1.0",
			description:
				"REST API generated from the Nixploy tRPC routers. Authenticate with an API key (`x-api-key` header) created under Settings → Profile.",
		},
		servers: [{ url: options.serverUrl ?? "/" }],
		tags,
		paths,
		components: {
			securitySchemes: {
				apiKey: {
					type: "apiKey",
					in: "header",
					name: "x-api-key",
				},
			},
		},
	};
}

export type OpenApiDocument = ReturnType<typeof generateOpenApiDocument>;
