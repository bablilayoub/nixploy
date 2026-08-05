import { describe, expect, it } from "vitest";
import { generateOpenApiDocument } from "./openapi";
import { appRouter } from "./root";

interface Operation {
	tags: string[];
	operationId: string;
	security: Array<Record<string, string[]>>;
	parameters?: unknown[];
	requestBody?: unknown;
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
