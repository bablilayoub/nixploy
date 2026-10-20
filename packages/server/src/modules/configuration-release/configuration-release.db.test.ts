import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TeamScopedFixture, TenantFixture } from "../../trpc/tenancy.harness";

const testUrl = process.env.DATABASE_URL_TEST;
describe.skipIf(!testUrl)("configuration releases (postgres)", () => {
	let store: typeof import("../../db");
	let schema: typeof import("../../db/schema");
	let fixtures: typeof import("../../trpc/tenancy.harness");
	let organizationEnv: typeof import("../projects/organization-env");
	let scopes: typeof import("../projects");
	let queue: typeof import("../deployment/queue");
	let tenant: TenantFixture;
	let other: TenantFixture;
	let scoped: TeamScopedFixture;
	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl;
		process.env.DOCKER_HOST = "unix:///nixploy-test-no-docker.sock";
		store = await import("../../db");
		schema = await import("../../db/schema");
		fixtures = await import("../../trpc/tenancy.harness");
		organizationEnv = await import("../projects/organization-env");
		scopes = await import("../projects");
		queue = await import("../deployment/queue");
		await queue.drainQueue({ graceMs: 0 });
		tenant = await fixtures.seedOneTenant(`config-${randomUUID().slice(0, 6)}`);
		other = await fixtures.seedOneTenant(`other-${randomUUID().slice(0, 6)}`);
		scoped = await fixtures.seedTeamScopedMember(tenant);
		await store.db
			.update(schema.applications)
			.set({
				sourceType: "docker",
				dockerImage: "alpine:3",
				env: 'TOKEN="service words"\nEMPTY=',
				serverId: tenant.serverId,
			})
			.where(eq(schema.applications.applicationId, tenant.applicationId));
		await store.db
			.update(schema.compose)
			.set({
				sourceType: "raw",
				composeFile: "services:\n  web:\n    image: alpine:3\n",
				env: "COMPOSE=service",
			})
			.where(eq(schema.compose.composeId, tenant.composeId));
		await store.db
			.update(schema.projects)
			.set({ env: "LEVEL=project\nPROJECT=1" })
			.where(eq(schema.projects.projectId, tenant.projectId));
		await store.db
			.update(schema.environments)
			.set({ env: "LEVEL=environment\nQUOTED='\"literal\"'" })
			.where(eq(schema.environments.environmentId, tenant.environmentId));
		await organizationEnv.saveOrganizationEnvironment(
			tenant.organizationId,
			'ORG="shared # value"\nLEVEL=organization\nTOKEN=organization',
		);
	});
	afterAll(async () => {
		if (scoped) await fixtures.wipeTeamScopedMember(scoped);
		if (tenant) await fixtures.wipeTenant(tenant);
		if (other) await fixtures.wipeTenant(other);
	});
	const caller = () => fixtures.createTestCaller(tenant.session);
	const appScope = () => ({ kind: "application" as const, id: tenant.applicationId });
	it("saves application drafts without any runtime call and stores org secrets encrypted", async () => {
		await expect(
			caller().application.saveEnvironment({
				applicationId: tenant.applicationId,
				env: 'TOKEN="service words"\nEMPTY=',
			}),
		).resolves.toMatchObject({ env: 'TOKEN="service words"\nEMPTY=' });
		const raw = (await store.db.execute(
			sql`select env from organization_environment where organization_id=${tenant.organizationId}`,
		)) as unknown as Array<{ env: string }>;
		expect(raw[0]?.env).toMatch(/^v\d+:/);
		expect(raw[0]?.env).not.toContain("shared");
		expect(await organizationEnv.loadOrganizationEnvironment(tenant.organizationId)).toContain(
			'ORG="shared # value"',
		);
	});
	it("reviews only reachable apps/Compose and redacts values/names under the secret ceiling", async () => {
		const plan = await caller().configurationRelease.review({ scope: { kind: "organization" } });
		expect(plan.targets.map((target) => target.kind)).toContain("application");
		expect(plan.targets.some((target) => target.kind === "compose")).toBe(true);
		expect(plan.targets.some((target) => target.id === other.applicationId)).toBe(false);
		expect(JSON.stringify(plan)).not.toContain("service words");
		expect(JSON.stringify(plan)).not.toContain("shared # value");
		const redacted = await scopes.runWithCapabilityScope(
			{ allowed: new Set(["service.deploy"]), organizationId: tenant.organizationId },
			() => caller().configurationRelease.review({ scope: appScope() }),
		);
		expect(redacted.redacted).toBe(true);
		expect(redacted.targets[0]?.changes).toBeNull();
		expect(JSON.stringify(redacted)).not.toContain("TOKEN");
		const teamCaller = fixtures.createTestCaller(scoped.session);
		const teamPlan = await teamCaller.configurationRelease.review({
			scope: { kind: "organization" },
		});
		expect(teamPlan.targets.some((target) => target.id === scoped.otherApplicationId)).toBe(false);
		await expect(
			teamCaller.configurationRelease.review({
				scope: { kind: "application", id: scoped.otherApplicationId },
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it("rejects review drift and permission loss before enqueuing any deployment", async () => {
		const plan = await caller().configurationRelease.review({ scope: appScope() });
		await store.db
			.update(schema.environments)
			.set({ env: "LEVEL=edited-after-review" })
			.where(eq(schema.environments.environmentId, tenant.environmentId));
		await expect(
			caller().configurationRelease.deployReviewed({
				scope: appScope(),
				reviewToken: plan.token,
				targets: [{ kind: "application", id: tenant.applicationId }],
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const fresh = await caller().configurationRelease.review({ scope: appScope() });
		await store.db
			.update(schema.members)
			.set({ role: "viewer" })
			.where(
				and(
					eq(schema.members.organizationId, tenant.organizationId),
					eq(schema.members.userId, tenant.userId),
				),
			);
		await expect(
			caller().configurationRelease.deployReviewed({
				scope: appScope(),
				reviewToken: fresh.token,
				targets: [{ kind: "application", id: tenant.applicationId }],
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await store.db
			.update(schema.members)
			.set({ role: "owner" })
			.where(
				and(
					eq(schema.members.organizationId, tenant.organizationId),
					eq(schema.members.userId, tenant.userId),
				),
			);
		const jobs = await store.db
			.select()
			.from(schema.deployments)
			.where(eq(schema.deployments.applicationId, tenant.applicationId));
		expect(jobs).toHaveLength(0);
	});
	it("rechecks team visibility at apply and rejects stale access", async () => {
		const teamCaller = fixtures.createTestCaller(scoped.session);
		const plan = await teamCaller.configurationRelease.review({ scope: appScope() });
		await store.db
			.delete(schema.teamMembers)
			.where(
				and(
					eq(schema.teamMembers.teamId, scoped.teamId),
					eq(schema.teamMembers.userId, scoped.userId),
				),
			);
		await expect(
			teamCaller.configurationRelease.deployReviewed({
				scope: appScope(),
				reviewToken: plan.token,
				targets: [{ kind: "application", id: tenant.applicationId }],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await store.db
			.insert(schema.teamMembers)
			.values({ teamId: scoped.teamId, userId: scoped.userId });
	});
	it("requires deploy and secret-write together, and rolls back an invalid batch selection", async () => {
		const plan = await caller().configurationRelease.review({
			scope: { kind: "project", id: tenant.projectId },
		});
		const input = {
			scope: plan.scope,
			reviewToken: plan.token,
			targets: [
				{ kind: "application" as const, id: tenant.applicationId },
				{ kind: "compose" as const, id: other.composeId },
			],
		};
		await expect(caller().configurationRelease.deployReviewed(input)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		const jobs = await store.db
			.select()
			.from(schema.deployments)
			.where(eq(schema.deployments.applicationId, tenant.applicationId));
		expect(jobs).toHaveLength(0);
		await expect(
			scopes.runWithCapabilityScope(
				{ allowed: new Set(["secrets.write"]), organizationId: tenant.organizationId },
				() =>
					caller().configurationRelease.deployReviewed({
						...input,
						targets: [{ kind: "application", id: tenant.applicationId }],
					}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
	it("queues immutable encrypted snapshots atomically, then preserves them across late edits", async () => {
		const scope = { kind: "environment" as const, id: tenant.environmentId };
		const plan = await caller().configurationRelease.review({ scope });
		const result = await caller().configurationRelease.deployReviewed({
			scope,
			reviewToken: plan.token,
			targets: [
				{ kind: "application", id: tenant.applicationId },
				{ kind: "compose", id: tenant.composeId },
			],
		});
		expect(result.deployments).toHaveLength(2);
		const { findDeploymentEnvironment } = await import("../deployment/environment-snapshot");
		const id = result.deployments.find((job) => job.kind === "application")?.deploymentId as string;
		const before = await findDeploymentEnvironment(id);
		expect(before?.runtimeEnv).toContain('ORG="shared # value"');
		expect(before?.runtimeEnv).toContain('TOKEN="service words"');
		expect(before?.releaseId).toBe(result.releaseId);
		const raw = (await store.db.execute(
			sql`select runtime_env,service_env from deployment_environment_snapshot where deployment_id=${id}`,
		)) as unknown as Array<{ runtime_env: string; service_env: string }>;
		expect(raw[0]?.runtime_env).toMatch(/^v\d+:/);
		expect(raw[0]?.service_env).not.toContain("service words");
		await organizationEnv.saveOrganizationEnvironment(tenant.organizationId, "ORG=late-change");
		await store.db
			.update(schema.applications)
			.set({ env: "TOKEN=late-secret" })
			.where(eq(schema.applications.applicationId, tenant.applicationId));
		expect((await findDeploymentEnvironment(id))?.runtimeEnv).toBe(before?.runtimeEnv);
		const claim = await queue.claimNextDeployment(tenant.serverId);
		expect(claim?.deploymentId).toBe(id);
		// Do not leave a running test job behind for later serialized suites.
		await store.db
			.update(schema.deployments)
			.set({ status: "cancelled" })
			.where(eq(schema.deployments.deploymentId, id));
	});
	it("rejects mixed old workers and old plaintext metadata readers/writers", async () => {
		await expect(
			store.db.execute(sql`select metadata from organization where id=${tenant.organizationId}`),
		).rejects.toThrow(/metadata/);
		await expect(
			store.db.execute(
				sql`update organization set metadata_v2='{"env":"PLAINTEXT=forbidden"}' where id=${tenant.organizationId}`,
			),
		).rejects.toMatchObject({ cause: { message: expect.stringMatching(/encrypted/) } });
		const queued = await store.db
			.select()
			.from(schema.deployments)
			.where(
				and(
					eq(schema.deployments.composeId, tenant.composeId),
					eq(schema.deployments.status, "queued"),
				),
			);
		expect(queued.length).toBe(1);
		await expect(
			store.db
				.update(schema.deployments)
				.set({ status: "running" })
				.where(eq(schema.deployments.deploymentId, queued[0]?.deploymentId ?? "")),
		).rejects.toMatchObject({ cause: { message: expect.stringMatching(/worker predates/) } });
	});
	it("backfills legacy plaintext once, preserves unrelated metadata, and refuses ambiguous conflicts", async () => {
		// Reconstruct a pre-upgrade row under this isolated test DB's transactional
		// schema lock. Production never disables the fence.
		const legacy = 'LEGACY="key rotation canary"';
		await store.db.transaction(async (tx) => {
			await tx.execute(
				sql`alter table organization disable trigger organization_environment_storage`,
			);
			await tx
				.update(schema.organizations)
				.set({
					metadata: JSON.stringify({
						env: legacy,
						quotas: { maxProjects: 7 },
						branding: { displayName: "Preserved" },
					}),
				})
				.where(eq(schema.organizations.id, other.organizationId));
			await tx.execute(
				sql`alter table organization enable trigger organization_environment_storage`,
			);
		});
		await expect(organizationEnv.loadOrganizationEnvironment(other.organizationId)).rejects.toThrow(
			/upgrade/,
		);
		expect((await organizationEnv.migrateOrganizationEnvironments()).migrated).toBe(1);
		expect(await organizationEnv.loadOrganizationEnvironment(other.organizationId)).toBe(legacy);
		const [org] = await store.db
			.select()
			.from(schema.organizations)
			.where(eq(schema.organizations.id, other.organizationId));
		expect(JSON.parse(org?.metadata ?? "{}")).toEqual({
			quotas: { maxProjects: 7 },
			branding: { displayName: "Preserved" },
		});
		const encrypted = (await store.db.execute(
			sql`select env from organization_environment where organization_id=${other.organizationId}`,
		)) as unknown as Array<{ env: string }>;
		expect(encrypted[0]?.env).not.toContain("canary");
		expect((await organizationEnv.migrateOrganizationEnvironments()).migrated).toBe(0);
		await store.db.transaction(async (tx) => {
			await tx.execute(
				sql`alter table organization disable trigger organization_environment_storage`,
			);
			await tx
				.update(schema.organizations)
				.set({
					metadata: JSON.stringify({
						env: "LEGACY=conflicting-writer",
						quotas: { maxProjects: 7 },
					}),
				})
				.where(eq(schema.organizations.id, other.organizationId));
			await tx.execute(
				sql`alter table organization enable trigger organization_environment_storage`,
			);
		});
		await expect(organizationEnv.migrateOrganizationEnvironments()).rejects.toThrow(/conflicting/);
		const [stillEncrypted] = await store.db
			.select()
			.from(schema.organizationEnvironments)
			.where(eq(schema.organizationEnvironments.organizationId, other.organizationId));
		expect(stillEncrypted?.env).toBe(legacy);
	});
	it("manual Compose rollback queues historical merged variables instead of current shared drafts", async () => {
		const [job] = await store.db
			.insert(schema.deployments)
			.values({
				title: "Historic configuration",
				status: "done",
				composeId: tenant.composeId,
				appName: "historic-compose-test",
				logPath: "/tmp/historic-compose.log",
			})
			.returning();
		if (!job) throw new Error("Missing fixture deployment");
		const { recordComposeSnapshot } = await import("../compose/snapshot");
		await recordComposeSnapshot({
			deploymentId: job.deploymentId,
			composeId: tenant.composeId,
			sourceFile: "services:\n  web:\n    image: alpine:3\n",
			renderedFile: "services: {}",
			serviceEnv: "APP=historic",
			mergedEnv: "SHARED=historic\nAPP=historic",
		});
		const { recordDeploymentEnvironment, findDeploymentEnvironment } = await import(
			"../deployment/environment-snapshot"
		);
		await recordDeploymentEnvironment(job.deploymentId, {
			runtimeEnv: "SHARED=historic\nAPP=historic",
			serviceEnv: "APP=historic",
			buildArgs: "TOKEN=historic-build",
			sourceFingerprint: "a".repeat(64),
		});
		const result = await caller().compose.rollback({
			composeId: tenant.composeId,
			deploymentId: job.deploymentId,
		});
		expect(await findDeploymentEnvironment(result.deploymentId)).toMatchObject({
			runtimeEnv: "SHARED=historic\nAPP=historic",
			serviceEnv: "APP=historic",
			buildArgs: "TOKEN=historic-build",
		});
		const [row] = await store.db
			.select()
			.from(schema.compose)
			.where(eq(schema.compose.composeId, tenant.composeId));
		expect(row?.env).toBe("APP=historic");
	});
});
