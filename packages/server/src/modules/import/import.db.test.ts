import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({
	listProjects: vi.fn(),
	getApplication: vi.fn(),
	getCompose: vi.fn(),
}));
vi.mock("./client", () => ({
	SourcePanelClient: {
		connect: async () => ({
			host: "source.example.com",
			listProjects: source.listProjects,
			getApplication: source.getApplication,
			getCompose: source.getCompose,
			close: async () => {},
		}),
	},
}));

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("import project access (postgres)", () => {
	it("imports image services without runtime or proxy changes, and keeps manually replaced mounts on repeat", async () => {
		process.env.DATABASE_URL = testUrl;
		const configDir = await mkdtemp(path.join(os.tmpdir(), "nixploy-import-test-"));
		const previousConfigDir = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = configDir;
		const { db } = await import("../../db");
		const { applications, mounts } = await import("../../db/schema");
		const { createTestCaller, seedOneTenant, wipeTenant } = await import(
			"../../trpc/tenancy.harness"
		);
		const { sourceApplicationSchema, sourceComposeSchema, sourceProjectListSchema } = await import(
			"./source-schema"
		);
		const appService = await import("../application/service");
		const { resolveFileMountPath } = await import("../application/paths");
		const composeService = await import("../compose/service");
		const runtime = vi.spyOn(appService, "upsertApplicationSwarmService").mockResolvedValue();
		const appProxy = vi.spyOn(appService, "syncApplicationTraefik").mockResolvedValue();
		const composeProxy = vi.spyOn(composeService, "resyncComposeDomains").mockResolvedValue();
		const tenant = await seedOneTenant("import-runtime");
		try {
			const suffix = randomUUID().slice(0, 8);
			source.listProjects.mockResolvedValue(
				sourceProjectListSchema.parse([
					{
						projectId: "source",
						name: "Source",
						environments: [
							{
								environmentId: "env",
								name: "production",
								applications: [{ applicationId: "web", name: "import-web" }],
								compose: [{ composeId: "stack", name: "import-stack" }],
							},
						],
					},
				]),
			);
			source.getApplication.mockResolvedValue(
				sourceApplicationSchema.parse({
					applicationId: "web",
					name: "import-web",
					appName: `source-web-${suffix}`,
					sourceType: "docker",
					dockerImage: "traefik/whoami:v1.10.1",
					env: "SECRET=source",
					domains: [{ host: `web-${suffix}.example.test`, port: 80 }],
					mounts: [
						{ type: "volume", volumeName: `source-web-${suffix}-data`, mountPath: "/data" },
						{
							type: "file",
							filePath: "settings.env",
							mountPath: "/etc/settings.env",
							content: "SOURCE=must-not-overwrite",
						},
					],
				}),
			);
			source.getCompose.mockResolvedValue(
				sourceComposeSchema.parse({
					composeId: "stack",
					name: "import-stack",
					appName: `source-stack-${suffix}`,
					sourceType: "raw",
					domains: [{ host: `stack-${suffix}.example.test`, serviceName: "echo", port: 80 }],
				}),
			);
			const caller = createTestCaller(tenant.session);
			const input = {
				source: "dokploy" as const,
				url: "https://source.example.com",
				apiKey: "test-key",
				sourceProjectId: "source",
				projectId: tenant.projectId,
				keepAppNames: false,
			};
			expect((await caller.import.runApply(input)).result.errors).toEqual([]);
			const imported = await db.query.applications.findFirst({
				where: and(
					eq(applications.environmentId, tenant.environmentId),
					eq(applications.name, "import-web"),
				),
			});
			if (!imported) throw new Error("Imported application missing");
			expect(imported.status).toBe("idle");
			await db.insert(mounts).values({
				type: "volume",
				mountPath: "/data",
				volumeName: `${imported.appName}-restored`,
				serviceType: "application",
				applicationId: imported.applicationId,
			});
			await db.insert(mounts).values({
				type: "file",
				mountPath: "/etc/settings.env",
				filePath: "settings.env",
				content: "MANUAL=restored",
				serviceType: "application",
				applicationId: imported.applicationId,
			});
			await appService.materializeFileMount(imported.appName, "settings.env", "MANUAL=restored");
			expect((await caller.import.runApply(input)).result.errors).toEqual([]);
			expect(
				await db.query.mounts.findMany({ where: eq(mounts.applicationId, imported.applicationId) }),
			).toHaveLength(2);
			expect(await readFile(resolveFileMountPath(imported.appName, "settings.env"), "utf8")).toBe(
				"MANUAL=restored",
			);
			expect(runtime).not.toHaveBeenCalled();
			expect(appProxy).not.toHaveBeenCalled();
			expect(composeProxy).not.toHaveBeenCalled();
		} finally {
			await wipeTenant(tenant);
			vi.restoreAllMocks();
			if (previousConfigDir === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
			else process.env.NIXPLOY_CONFIG_DIR = previousConfigDir;
			await rm(configDir, { recursive: true, force: true });
		}
	});

	it("rejects a hidden target resolved by name before exposing its id or creating an environment", async () => {
		process.env.DATABASE_URL = testUrl;
		const { db } = await import("../../db");
		const { environments, members, projects } = await import("../../db/schema");
		const {
			createTestCaller,
			seedOneTenant,
			seedTeamScopedMember,
			wipeTeamScopedMember,
			wipeTenant,
		} = await import("../../trpc/tenancy.harness");
		const { sourceProjectListSchema } = await import("./source-schema");
		const tenant = await seedOneTenant("import-scope");
		const scoped = await seedTeamScopedMember(tenant);
		try {
			const hidden = await db.query.projects.findFirst({
				where: eq(projects.projectId, scoped.otherProjectId),
			});
			source.listProjects.mockResolvedValue(
				sourceProjectListSchema.parse([
					{
						projectId: "source-project",
						name: hidden?.name,
						environments: [{ environmentId: "source-env", name: "production" }],
					},
				]),
			);
			const caller = createTestCaller(scoped.session);
			const input = {
				source: "dokploy" as const,
				url: "https://source.example.com",
				apiKey: "test-key",
				sourceProjectId: "source-project",
				environmentName: "new-import-environment",
			};
			await expect(caller.import.plan(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
			await expect(caller.import.runApply(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
			expect(
				await db.query.environments.findFirst({
					where: and(
						eq(environments.projectId, scoped.otherProjectId),
						eq(environments.name, input.environmentName),
					),
				}),
			).toBeUndefined();
			await expect(
				caller.import.plan({ ...input, projectId: scoped.otherProjectId }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });

			// The same source name is usable when the team can reach the target.
			const visible = await db.query.projects.findFirst({
				where: eq(projects.projectId, tenant.projectId),
			});
			source.listProjects.mockResolvedValue(
				sourceProjectListSchema.parse([
					{
						projectId: "source-project",
						name: visible?.name,
						environments: [{ environmentId: "source-env", name: "production" }],
					},
				]),
			);
			expect((await caller.import.plan(input)).target.projectId).toBe(tenant.projectId);

			await db.update(members).set({ role: "viewer" }).where(eq(members.userId, scoped.userId));
			await expect(caller.import.inspect(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
			await expect(caller.import.plan(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
			await expect(caller.import.runApply(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
		} finally {
			await wipeTeamScopedMember(scoped);
			await wipeTenant(tenant);
		}
	});
});
