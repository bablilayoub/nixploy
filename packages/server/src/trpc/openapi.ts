import { z } from "zod";
import { type ProcedureDoc, procedureDoc } from "./procedure-docs";
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
 *
 * Prose comes from three places, in order of preference:
 *   1. the procedure's own tRPC `meta` (`{ summary, description, capability }`)
 *      — no router declares it yet, but the mechanism is live so routers can
 *      migrate one at a time,
 *   2. `procedure-docs.ts`, the side-table that documents the surface today,
 *   3. the procedure path, as a last resort.
 *
 * Output schemas are emitted from `.output()` where a procedure declares one.
 * Almost none do yet; adopting `.output(schema)` in a router immediately makes
 * its response typed in Swagger and in any generated client.
 */

interface OpenApiOperation {
	tags: string[];
	summary: string;
	description?: string;
	operationId: string;
	security: Array<Record<string, string[]>>;
	parameters?: unknown[];
	requestBody?: unknown;
	responses: Record<string, unknown>;
	/** Capabilities the caller needs; absent when the procedure only needs a session. */
	"x-nixploy-capability"?: string[];
	/** True when the caller must also be the instance admin (platform owner). */
	"x-nixploy-instance-admin"?: boolean;
}

type JsonSchema = Record<string, unknown>;

const GENERIC_INPUT_SCHEMA: JsonSchema = {
	type: "object",
	additionalProperties: true,
};

/** Convert a zod parser to JSON Schema, tolerating shapes zod cannot express. */
function toJsonSchema(parser: unknown, io: "input" | "output"): JsonSchema | null {
	if (!parser) return null;
	try {
		const schema = z.toJSONSchema(parser as z.ZodType, { io, unrepresentable: "any" });
		const { $schema: _ignored, ...rest } = schema as Record<string, unknown>;
		return rest as JsonSchema;
	} catch {
		return GENERIC_INPUT_SCHEMA;
	}
}

function inputJsonSchema(procedureDef: { inputs?: unknown[] }): JsonSchema | null {
	// tRPC stores the raw zod schema as the first input parser.
	return toJsonSchema(procedureDef.inputs?.[0], "input");
}

function outputJsonSchema(procedureDef: {
	output?: unknown;
	outputs?: unknown[];
}): JsonSchema | null {
	const parser = procedureDef.output ?? procedureDef.outputs?.[0];
	if (!parser) return null;
	return toJsonSchema(parser, "output");
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
				...(typeof propSchema.description === "string"
					? { description: propSchema.description }
					: {}),
				schema:
					type === "string" || type === "number" || type === "integer" || type === "boolean"
						? { type }
						: { type: "string", description: "JSON-encoded value" },
			});
		}
	}
	return parameters;
}

/** tRPC wraps every successful payload in `{ result: { data } }`. */
function successResponse(outputSchema: JsonSchema | null): Record<string, unknown> {
	return {
		description: "tRPC-style success envelope",
		content: {
			"application/json": {
				schema: {
					type: "object",
					properties: {
						result: {
							type: "object",
							properties: { data: outputSchema ?? { description: "Procedure payload" } },
						},
					},
				},
			},
		},
	};
}

const ERROR_SCHEMA: JsonSchema = {
	type: "object",
	properties: {
		message: { type: "string" },
		error: {
			type: "object",
			properties: {
				message: { type: "string" },
				code: { type: "integer", description: "JSON-RPC style numeric code" },
				data: {
					type: "object",
					properties: {
						code: { type: "string", description: "tRPC error code, e.g. FORBIDDEN" },
						httpStatus: { type: "integer" },
					},
				},
			},
		},
	},
};

const errorResponse = (description: string) => ({
	description,
	content: { "application/json": { schema: ERROR_SCHEMA } },
});

function responsesFor(outputSchema: JsonSchema | null): Record<string, unknown> {
	return {
		"200": successResponse(outputSchema),
		"400": errorResponse("Invalid input (Zod validation failed)"),
		"401": errorResponse("Missing, expired or revoked API key"),
		"403": errorResponse("The key's user lacks the capability this procedure requires"),
		"404": errorResponse("Unknown procedure, or the resource is not in the caller's organization"),
		"429": errorResponse("Per-key rate limit exceeded"),
		"500": errorResponse("Internal server error"),
	};
}

/** Prose for one procedure: `meta` first, then the docs side-table. */
export function describeProcedure(
	path: string,
	meta: Record<string, unknown> | undefined,
): ProcedureDoc {
	const fromMeta: Partial<ProcedureDoc> = {
		summary: typeof meta?.summary === "string" ? meta.summary : undefined,
		description: typeof meta?.description === "string" ? meta.description : undefined,
		capability: Array.isArray(meta?.capability)
			? (meta.capability as string[])
			: typeof meta?.capability === "string"
				? [meta.capability]
				: undefined,
		instanceAdmin: typeof meta?.instanceAdmin === "boolean" ? meta.instanceAdmin : undefined,
	};
	const fromTable = procedureDoc(path);
	return {
		summary: fromMeta.summary ?? fromTable?.summary ?? path,
		description: fromMeta.description ?? fromTable?.description ?? "",
		capability: fromMeta.capability ?? fromTable?.capability,
		instanceAdmin: fromMeta.instanceAdmin ?? fromTable?.instanceAdmin,
	};
}

export interface OpenApiOptions {
	title?: string;
	version?: string;
	serverUrl?: string;
}

/** One tag per router, so Swagger groups the 390 endpoints usefully. */
const TAG_DESCRIPTIONS: Record<string, string> = {
	traefik:
		"Instance-level Traefik entrypoints for TCP/UDP routing (instance admin; changing them restarts the proxy)",
	volumeFiles:
		"Browse, read, write and delete files inside a Docker volume (instance admin, docker.manage)",
	ai: "Deploy Copilot: explain failures, chat, generate compose files",
	application: "Applications: CRUD, source, build, deploy and Swarm runtime",
	audit: "Organization audit trail",
	backup: "Database backup schedules, runs, restore and verification",
	bitbucket: "Bitbucket connections, repositories and branches",
	certificate: "Custom TLS certificates",
	compose: "Compose and Swarm-stack services",
	deployment: "Deployment history and build logs",
	destination: "Backup storage destinations (S3-compatible or local disk)",
	docker: "Docker control centre: containers, images, networks, volumes, Swarm",
	domain: "Traefik domains, TLS and middleware chains",
	environment: "Project environments",
	gitea: "Gitea connections, repositories and branches",
	github: "GitHub App connections, repositories and branches",
	gitlab: "GitLab connections, repositories and branches",
	gitops: "Desired-state export, plan and apply for `nixploy.yaml`",
	mariadb: "MariaDB database services",
	mongo: "MongoDB database services",
	monitoring: "Live and historical metrics, fleet overview",
	mount: "Service mounts (bind, volume, file)",
	mysql: "MySQL database services",
	notification: "Notification channels",
	observability: "Incidents, alert rules, uptime probes, log search",
	organization: "Organization settings, members, capabilities and shared env",
	port: "Published Swarm ports",
	postgres: "PostgreSQL database services",
	previewDeployment: "Pull-request preview deployments",
	project: "Projects and project-level environment variables",
	redirect: "Traefik redirect middlewares",
	redis: "Redis database services",
	registry: "Private container registries",
	rollback: "Stored rollback image pins",
	schedule: "Cron schedules for services, servers and the panel",
	security: "HTTP basic-auth users guarding routes",
	server: "Remote Docker Swarm servers",
	setup: "First-boot setup and invitation preview (public)",
	sshKey: "SSH keys for git and server access",
	tag: "Organization tags and service assignments",
	team: "Teams: which projects a member may reach (members.manage)",
	template: "One-click template catalog",
	updates: "In-app panel updates from GHCR",
	volumeBackup: "Named-volume backup schedules",
	webServer: "Panel access domain, Traefik and host maintenance",
};

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
			const outputSchema = outputJsonSchema(def as { output?: unknown; outputs?: unknown[] });
			const doc = describeProcedure(path, def.meta as Record<string, unknown> | undefined);

			const operation: OpenApiOperation = {
				tags: [tag],
				summary: doc.summary,
				operationId: path,
				security: [{ apiKey: [] }],
				responses: responsesFor(outputSchema),
			};
			if (doc.description) {
				operation.description = doc.description;
			}
			if (doc.capability && doc.capability.length > 0) {
				operation["x-nixploy-capability"] = [...doc.capability];
			}
			if (doc.instanceAdmin) {
				operation["x-nixploy-instance-admin"] = true;
			}

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
		.map((name) => ({
			name,
			...(TAG_DESCRIPTIONS[name] ? { description: TAG_DESCRIPTIONS[name] } : {}),
		}));

	return {
		openapi: "3.0.3",
		info: {
			title: options.title ?? "Nixploy API",
			version: options.version ?? "0.1.0",
			description: [
				"REST API generated from the Nixploy tRPC routers. Authenticate with an API key",
				"(`x-api-key` header) created under Settings → Profile.",
				"",
				"Queries are `GET /api/<router>.<procedure>` with the input flattened into query",
				"parameters (or `?input=<URL-encoded JSON>` for nested payloads); mutations are",
				"`POST /api/<router>.<procedure>` with the input as the JSON body. Every success",
				'payload is wrapped in the tRPC envelope `{ "result": { "data": … } }`.',
				"",
				"Each operation carries `x-nixploy-capability`: the organization capabilities the",
				"key's user must hold (see docs/auth.md). `x-nixploy-instance-admin` marks the",
				"operations that additionally require the platform owner.",
				"",
				"A multi-organization key selects its organization with `x-organization-id`.",
			].join("\n"),
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
