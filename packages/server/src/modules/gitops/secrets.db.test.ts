import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("partial secrets payload (postgres)", () => {
	it("keeps manually restored values when a dump omits encrypted columns, while explicit clears still apply", async () => {
		process.env.DATABASE_URL = testUrl;
		const { db } = await import("../../db");
		const schema = await import("../../db/schema");
		const { seedOneTenant, wipeTenant } = await import("../../trpc/tenancy.harness");
		const { loadEnvironmentGraph } = await import("./live");
		const { applySecretsPayload, collectSecrets } = await import("./secrets");
		const fixture = await seedOneTenant("partial-secrets");
		try {
			await db
				.update(schema.projects)
				.set({ env: "PROJECT=manual" })
				.where(eq(schema.projects.projectId, fixture.projectId));
			await db
				.update(schema.environments)
				.set({ env: "ENV=manual" })
				.where(eq(schema.environments.environmentId, fixture.environmentId));
			await db
				.update(schema.applications)
				.set({ env: "APP=manual", buildArgs: "BUILD=manual", previewEnv: "PREVIEW=manual" })
				.where(eq(schema.applications.applicationId, fixture.applicationId));
			await db
				.update(schema.compose)
				.set({ env: "STACK=manual" })
				.where(eq(schema.compose.composeId, fixture.composeId));
			await db
				.update(schema.postgres)
				.set({ env: "DB=manual" })
				.where(eq(schema.postgres.postgresId, fixture.postgresId));
			const load = () =>
				loadEnvironmentGraph(fixture.projectId, "production", fixture.organizationId);
			const graph = await load();
			const original = collectSecrets(graph);
			const payload = {
				version: 1 as const,
				project: { name: graph.project.name },
				environment: { name: graph.environment.name },
				applications: { [graph.services.applications[0]?.name ?? ""]: {} },
				compose: { [graph.services.compose[0]?.name ?? ""]: {} },
				databases: { postgres: { [graph.services.postgres[0]?.name ?? ""]: {} } },
			};
			expect((await applySecretsPayload(payload, graph)).applied).toEqual([]);
			expect((await applySecretsPayload(payload, await load())).applied).toEqual([]);
			expect(collectSecrets(await load())).toEqual(original);

			await applySecretsPayload(
				{
					...payload,
					project: { ...payload.project, env: "" },
					environment: { ...payload.environment, env: null },
					applications: {
						[graph.services.applications[0]?.name ?? ""]: {
							env: null,
							buildArgs: null,
							previewEnv: "",
						},
					},
					compose: { [graph.services.compose[0]?.name ?? ""]: { env: "" } },
					databases: { postgres: { [graph.services.postgres[0]?.name ?? ""]: { env: null } } },
				},
				await load(),
			);
			const cleared = await load();
			expect(cleared.project.env).toBe("");
			// Project/environment null already meant "leave it alone" in v1 bundles.
			expect(cleared.environment.env).toBe("ENV=manual");
			expect(cleared.services.applications[0]).toMatchObject({
				env: null,
				buildArgs: null,
				previewEnv: "",
			});
			expect(cleared.services.compose[0]?.env).toBe("");
			expect(cleared.services.postgres[0]?.env).toBeNull();
		} finally {
			await wipeTenant(fixture);
		}
	});
});
