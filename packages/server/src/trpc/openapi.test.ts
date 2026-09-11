import { describe, expect, it } from "vitest";
import { ORG_CAPABILITIES } from "../modules/projects/capabilities";
import { describeProcedure, generateOpenApiDocument } from "./openapi";
import { MAX_UNDOCUMENTED_PROCEDURES, procedureDocs } from "./procedure-docs";
import { appRouter } from "./root";

interface Operation {
	tags: string[];
	summary: string;
	description?: string;
	operationId: string;
	security: Array<Record<string, string[]>>;
	parameters?: unknown[];
	requestBody?: unknown;
	"x-nixploy-capability"?: string[];
}

/** Every `<router>.<procedure>` path the appRouter exposes. */
function procedurePaths(procedures: Record<string, unknown>, prefix = ""): string[] {
	const paths: string[] = [];
	for (const [key, value] of Object.entries(procedures)) {
		const def = (value as { _def?: Record<string, unknown> })._def;
		if (!def) continue;
		if (def.procedures) {
			paths.push(
				...procedurePaths(
					def.procedures as Record<string, unknown>,
					prefix ? `${prefix}.${key}` : key,
				),
			);
			continue;
		}
		if (def.type !== "query" && def.type !== "mutation") continue;
		paths.push(prefix ? `${prefix}.${key}` : key);
	}
	return paths;
}

/** Count every query/mutation procedure in the (possibly nested) router. */
function countProcedures(procedures: Record<string, unknown>): {
	queries: number;
	mutations: number;
} {
	let queries = 0;
	let mutations = 0;
	for (const value of Object.values(procedures)) {
		const def = (value as { _def?: Record<string, unknown> })._def;
		if (!def) continue;
		if (def.procedures) {
			const nested = countProcedures(def.procedures as Record<string, unknown>);
			queries += nested.queries;
			mutations += nested.mutations;
		} else if (def.type === "query") {
			queries += 1;
		} else if (def.type === "mutation") {
			mutations += 1;
		}
	}
	return { queries, mutations };
}

describe("generateOpenApiDocument", () => {
	const doc = generateOpenApiDocument();

	it("declares OpenAPI 3 and the apiKey security scheme", () => {
		expect(doc.openapi).toBe("3.0.3");
		expect(doc.components.securitySchemes.apiKey).toEqual({
			type: "apiKey",
			in: "header",
			name: "x-api-key",
		});
	});

	it("produces one path per tRPC procedure", () => {
		const { queries, mutations } = countProcedures(
			appRouter._def.procedures as Record<string, unknown>,
		);
		expect(queries + mutations).toBeGreaterThan(0);
		expect(Object.keys(doc.paths)).toHaveLength(queries + mutations);
	});

	it("maps queries to GET and mutations to POST", () => {
		let gets = 0;
		let posts = 0;
		for (const [path, methods] of Object.entries(doc.paths)) {
			expect(path.startsWith("/api/")).toBe(true);
			const verbs = Object.keys(methods);
			expect(verbs).toHaveLength(1);
			if (verbs[0] === "get") gets += 1;
			else if (verbs[0] === "post") posts += 1;
			else throw new Error(`Unexpected HTTP method ${verbs[0]} on ${path}`);
		}
		const { queries, mutations } = countProcedures(
			appRouter._def.procedures as Record<string, unknown>,
		);
		expect(gets).toBe(queries);
		expect(posts).toBe(mutations);
	});

	it("secures every operation with the apiKey scheme", () => {
		for (const methods of Object.values(doc.paths)) {
			for (const operation of Object.values(methods) as Operation[]) {
				expect(operation.security).toEqual([{ apiKey: [] }]);
			}
		}
	});

	it("gives queries an `input` query parameter and mutations a JSON body", () => {
		const queryOp = doc.paths["/api/project.all"]?.get as Operation | undefined;
		expect(queryOp).toBeDefined();
		expect(queryOp?.operationId).toBe("project.all");
		expect(queryOp?.tags).toEqual(["project"]);
		expect(queryOp?.requestBody).toBeUndefined();
		const paramNames = (queryOp?.parameters ?? []).map((p) => (p as { name: string }).name);
		expect(paramNames).toContain("input");

		const mutationOp = doc.paths["/api/project.create"]?.post as Operation | undefined;
		expect(mutationOp).toBeDefined();
		expect(mutationOp?.parameters).toBeUndefined();
		expect(mutationOp?.requestBody).toMatchObject({
			content: { "application/json": {} },
		});
	});

	it("flattens object input fields into query parameters", () => {
		// project.one takes { projectId: string } — it must appear as a query param.
		const op = doc.paths["/api/project.one"]?.get as Operation | undefined;
		const paramNames = (op?.parameters ?? []).map((p) => (p as { name: string }).name);
		expect(paramNames).toContain("projectId");
	});

	it("gives every operation a summary that is not just the path", () => {
		const undocumented: string[] = [];
		for (const [path, methods] of Object.entries(doc.paths)) {
			for (const operation of Object.values(methods) as Operation[]) {
				expect(operation.summary.length).toBeGreaterThan(0);
				if (operation.summary === operation.operationId) {
					undocumented.push(path);
				}
			}
		}
		// Documented coverage may only grow: lower MAX_UNDOCUMENTED_PROCEDURES
		// in procedure-docs.ts when you document more.
		expect(
			undocumented.length,
			`Undocumented procedures (add them to procedure-docs.ts): ${undocumented.join(", ")}`,
		).toBeLessThanOrEqual(MAX_UNDOCUMENTED_PROCEDURES);
	});

	it("tags every operation with its router and describes the tags", () => {
		const tagNames = new Set(doc.tags.map((tag) => tag.name));
		for (const [path, methods] of Object.entries(doc.paths)) {
			for (const operation of Object.values(methods) as Operation[]) {
				expect(operation.tags).toHaveLength(1);
				expect(operation.tags[0]).toBe(path.replace("/api/", "").split(".")[0]);
				expect(tagNames.has(operation.tags[0] as string)).toBe(true);
			}
		}
		// Most routers carry a human description; the list must not be empty.
		expect(doc.tags.filter((tag) => "description" in tag).length).toBeGreaterThan(20);
	});

	it("emits x-nixploy-capability for gated mutations", () => {
		const deploy = doc.paths["/api/application.deploy"]?.post as Operation | undefined;
		expect(deploy?.["x-nixploy-capability"]).toEqual(["service.deploy"]);
		const createDomain = doc.paths["/api/domain.create"]?.post as Operation | undefined;
		expect(createDomain?.["x-nixploy-capability"]).toEqual(["domains.manage"]);
		// Read-only procedures that need nothing beyond a session stay unannotated.
		expect(
			(doc.paths["/api/project.all"]?.get as Operation | undefined)?.["x-nixploy-capability"],
		).toBeUndefined();
	});

	it("types the 200 envelope and the error bodies", () => {
		const op = doc.paths["/api/project.all"]?.get as unknown as {
			responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
		};
		expect(op.responses["200"]?.content?.["application/json"]?.schema).toMatchObject({
			type: "object",
			properties: { result: { type: "object" } },
		});
		for (const status of ["400", "401", "403", "404", "429", "500"]) {
			expect(op.responses[status]?.content?.["application/json"]?.schema).toMatchObject({
				type: "object",
			});
		}
	});

	it("honors title/version/serverUrl options", () => {
		const custom = generateOpenApiDocument({
			title: "Custom",
			version: "9.9.9",
			serverUrl: "https://nixploy.example.com",
		});
		expect(custom.info.title).toBe("Custom");
		expect(custom.info.version).toBe("9.9.9");
		expect(custom.servers).toEqual([{ url: "https://nixploy.example.com" }]);
	});
});

describe("procedure-docs", () => {
	const registered = new Set(procedurePaths(appRouter._def.procedures as Record<string, unknown>));

	it("documents only procedures that exist (no stale entries)", () => {
		const stale = Object.keys(procedureDocs).filter((path) => !registered.has(path));
		expect(stale, `Stale procedure-docs entries: ${stale.join(", ")}`).toEqual([]);
	});

	it("lists only real capability ids", () => {
		const known = new Set<string>(ORG_CAPABILITIES);
		for (const [path, doc] of Object.entries(procedureDocs)) {
			for (const capability of doc.capability ?? []) {
				expect(known.has(capability), `${path} references unknown capability ${capability}`).toBe(
					true,
				);
			}
		}
	});

	it("gives every entry a distinct summary and a real description", () => {
		for (const [path, doc] of Object.entries(procedureDocs)) {
			expect(doc.summary, path).not.toBe(path);
			expect(doc.summary.length, path).toBeGreaterThan(4);
			expect(doc.description.length, path).toBeGreaterThan(20);
		}
	});

	it("covers the whole router surface within the undocumented allowance", () => {
		const missing = [...registered].filter((path) => !(path in procedureDocs)).sort();
		expect(
			missing.length,
			`Undocumented: ${missing.join(", ")} — document them in procedure-docs.ts or raise MAX_UNDOCUMENTED_PROCEDURES deliberately.`,
		).toBeLessThanOrEqual(MAX_UNDOCUMENTED_PROCEDURES);
	});

	it("prefers a procedure's own meta over the side-table", () => {
		const fromMeta = describeProcedure("project.all", {
			summary: "From meta",
			description: "Meta wins",
			capability: "project.write",
		});
		expect(fromMeta).toEqual({
			summary: "From meta",
			description: "Meta wins",
			capability: ["project.write"],
			instanceAdmin: undefined,
		});
		expect(describeProcedure("project.all", undefined).summary).toBe("List projects");
	});
});
