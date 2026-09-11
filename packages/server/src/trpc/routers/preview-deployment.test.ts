import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { appRouter } from "../root";

/**
 * A preview hangs off exactly one parent (the `preview_deployment_one_parent`
 * CHECK constraint). The zod inputs are the first line of that rule, so they
 * are asserted here rather than only in the database.
 */

const procedureInput = (path: string): ZodType => {
	const def = (appRouter._def.procedures as Record<string, { _def?: { inputs?: unknown[] } }>)[path]
		?._def;
	const input = def?.inputs?.[0];
	if (!input) throw new Error(`No input schema registered for ${path}`);
	return input as ZodType;
};

describe("previewDeployment input schemas", () => {
	for (const path of ["previewDeployment.list", "previewDeployment.create"]) {
		const extra = path.endsWith("create") ? { pullRequestNumber: "7" } : {};

		describe(path, () => {
			const schema = procedureInput(path);

			it("accepts an applicationId alone", () => {
				expect(schema.safeParse({ applicationId: "app-1", ...extra }).success).toBe(true);
			});

			it("accepts a composeId alone", () => {
				expect(schema.safeParse({ composeId: "cmp-1", ...extra }).success).toBe(true);
			});

			it("rejects both ids at once", () => {
				const result = schema.safeParse({ applicationId: "app-1", composeId: "cmp-1", ...extra });
				expect(result.success).toBe(false);
				expect(JSON.stringify(result.error?.issues)).toContain("Exactly one");
			});

			it("rejects neither id", () => {
				expect(schema.safeParse({ ...extra }).success).toBe(false);
			});
		});
	}

	it("keeps pullRequestNumber numeric on create (it names a service and a host)", () => {
		const schema = procedureInput("previewDeployment.create");
		expect(schema.safeParse({ composeId: "cmp-1", pullRequestNumber: "7" }).success).toBe(true);
		expect(schema.safeParse({ composeId: "cmp-1", pullRequestNumber: "7; rm -rf /" }).success).toBe(
			false,
		);
		expect(schema.safeParse({ composeId: "cmp-1", pullRequestNumber: "../.." }).success).toBe(
			false,
		);
	});

	it("still exposes byApplication for existing REST and CLI callers", () => {
		const schema = procedureInput("previewDeployment.byApplication");
		expect(schema.safeParse({ applicationId: "app-1" }).success).toBe(true);
		expect(schema.safeParse({ composeId: "cmp-1" }).success).toBe(false);
	});
});

describe("compose preview knobs", () => {
	const schema = procedureInput("compose.update");

	it("accepts the same five knobs, with the same bounds as the application router", () => {
		expect(
			schema.safeParse({
				composeId: "cmp-1",
				isPreviewDeploymentsActive: true,
				previewForksRequireApproval: false,
				previewEnv: "DATABASE_URL=postgres://scratch",
				previewLimit: 0,
				previewTtlHours: 24,
			}).success,
		).toBe(true);
		expect(schema.safeParse({ composeId: "cmp-1", previewLimit: 101 }).success).toBe(false);
		expect(schema.safeParse({ composeId: "cmp-1", previewTtlHours: 0 }).success).toBe(false);
		expect(schema.safeParse({ composeId: "cmp-1", previewTtlHours: null }).success).toBe(true);
	});
});
