import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coerceQueryInput, inputPropertyTypes } from "./query-input";
import { appRouter } from "./root";

const procedureInput = (path: string): unknown => {
	const def = (appRouter._def.procedures as Record<string, { _def?: { inputs?: unknown[] } }>)[path]
		?._def;
	return def?.inputs?.[0];
};

describe("coerceQueryInput", () => {
	it("leaves z.string() fields alone even when they look numeric or boolean", () => {
		const schema = z.object({ search: z.string().optional(), name: z.string(), flag: z.string() });
		expect(coerceQueryInput({ search: "2024", name: "1", flag: "true" }, schema)).toEqual({
			search: "2024",
			name: "1",
			flag: "true",
		});
	});

	it("coerces number / integer / boolean fields, including optional and nullable ones", () => {
		const schema = z.object({
			limit: z.number().int().optional(),
			ratio: z.number().nullable(),
			all: z.boolean().default(false),
			port: z.number().int().min(1).max(65535),
		});
		expect(
			coerceQueryInput({ limit: "50", ratio: "0.5", all: "true", port: "8080" }, schema),
		).toEqual({ limit: 50, ratio: 0.5, all: true, port: 8080 });
		expect(coerceQueryInput({ ratio: "null" }, schema)).toEqual({ ratio: null });
	});

	it("does not coerce values the target type cannot hold", () => {
		const schema = z.object({ limit: z.number(), all: z.boolean() });
		// Left as strings so Zod reports the real validation error.
		expect(coerceQueryInput({ limit: "abc", all: "yes" }, schema)).toEqual({
			limit: "abc",
			all: "yes",
		});
	});

	it("handles literal unions and string|number unions", () => {
		const schema = z.object({
			expiryDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
			mixed: z.union([z.string(), z.number()]),
		});
		expect(coerceQueryInput({ expiryDays: "7", mixed: "7" }, schema)).toEqual({
			expiryDays: 7,
			mixed: "7",
		});
	});

	it("leaves unknown keys and inputs without a schema as strings", () => {
		const schema = z.object({ limit: z.number() });
		expect(coerceQueryInput({ limit: "5", extra: "6" }, schema)).toEqual({ limit: 5, extra: "6" });
		expect(coerceQueryInput({ limit: "5" }, undefined)).toEqual({ limit: "5" });
		expect(inputPropertyTypes(undefined)).toBeNull();
		expect(inputPropertyTypes(z.string())).toBeNull();
	});

	it("keeps real router string inputs as strings and coerces real numeric ones", () => {
		const auditAll = procedureInput("audit.all");
		expect(auditAll).toBeDefined();
		const audit = coerceQueryInput({ search: "2024", limit: "10" }, auditAll);
		expect(audit.search).toBe("2024");
		expect(audit.limit).toBe(10);

		const resolved = procedureInput("project.getResolvedEnvironment");
		expect(resolved).toBeDefined();
		expect(
			coerceQueryInput({ projectId: "123", environmentName: "1" }, resolved).environmentName,
		).toBe("1");

		const prune = procedureInput("docker.containers");
		expect(prune).toBeDefined();
		expect(coerceQueryInput({ serverId: "42" }, prune)).toEqual({ serverId: "42" });
	});
});
