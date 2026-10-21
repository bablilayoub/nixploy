import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const effects = vi.hoisted(() => ({
	application: vi.fn(async () => {}),
	compose: vi.fn(async () => {}),
	database: vi.fn(async () => {}),
	network: vi.fn(async () => {}),
	upstream: vi.fn(async () => {}),
	file: vi.fn(async () => {}),
}));
vi.mock("../application/service", async (original) => ({
	...(await original<typeof import("../application/service")>()),
	deleteApplication: effects.application,
}));
vi.mock("../compose/service", async (original) => ({
	...(await original<typeof import("../compose/service")>()),
	deleteCompose: effects.compose,
}));
vi.mock("../databases/engine", async (original) => ({
	...(await original<typeof import("../databases/engine")>()),
	removeDatabase: effects.database,
}));
vi.mock("../deployment/network", async (original) => ({
	...(await original<typeof import("../deployment/network")>()),
	pruneEnvironmentNetwork: effects.network,
}));
vi.mock("../upstreams", async (original) => ({
	...(await original<typeof import("../upstreams")>()),
	removeUpstreamRoutesForEnvironment: effects.upstream,
}));
vi.mock("../traefik", async (original) => ({
	...(await original<typeof import("../traefik")>()),
	removeFileOnServer: effects.file,
}));

describe.skipIf(!process.env.DATABASE_URL_TEST)(
	"recovery-copy cascade boundaries (postgres)",
	() => {
		let db: typeof import("../../db")["db"];
		let schema: typeof import("../../db/schema");
		let harness: typeof import("../../trpc/tenancy.harness");
		let teardown: typeof import("./index");
		let guard: typeof import("../backups/recovery-copy-teardown")["assertRecoveryCopiesDeleted"];
		let a: TenantFixture;
		let b: TenantFixture;
		let copyEnvironmentId: string;

		beforeAll(async () => {
			process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
			({ db } = await import("../../db"));
			schema = await import("../../db/schema");
			harness = await import("../../trpc/tenancy.harness");
			teardown = await import("./index");
			({ assertRecoveryCopiesDeleted: guard } = await import("../backups/recovery-copy-teardown"));
			({ a, b } = await harness.seedTwoTenants());
			const [environment] = await db
				.insert(schema.environments)
				.values({ projectId: a.projectId, name: `recovery-cascade-${randomUUID()}` })
				.returning();
			if (!environment) throw new Error("Copy environment missing");
			copyEnvironmentId = environment.environmentId;
		}, 60_000);
		beforeEach(async () => {
			await db
				.delete(schema.recoveryCopies)
				.where(eq(schema.recoveryCopies.organizationId, a.organizationId));
			vi.clearAllMocks();
		});
		afterAll(async () => {
			if (a) {
				await db
					.delete(schema.recoveryCopies)
					.where(eq(schema.recoveryCopies.organizationId, a.organizationId));
				await harness.wipeTenant(a);
			}
			if (b) await harness.wipeTenant(b);
		});
		const seedCopy = async (values: Partial<typeof schema.recoveryCopies.$inferInsert> = {}) => {
			const [row] = await db
				.insert(schema.recoveryCopies)
				.values({
					organizationId: a.organizationId,
					requestId: randomUUID(),
					environmentId: copyEnvironmentId,
					name: "Retained cascade proof",
					objectKey: "owned/cascade.gz",
					deadline: new Date(Date.now() + 60_000),
					status: "ready",
					...values,
				})
				.returning();
			if (!row) throw new Error("Copy missing");
			return row;
		};
		const noEffects = () => {
			for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
		};

		it("refuses an unknown-origin copy with a missing target before environment teardown", async () => {
			const copy = await seedCopy({ targetPostgresId: null });
			await expect(teardown.deleteEnvironmentCascade(copyEnvironmentId)).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
			});
			noEffects();
			expect(
				await db.query.recoveryCopies.findFirst({
					where: eq(schema.recoveryCopies.recoveryCopyId, copy.recoveryCopyId),
				}),
			).toMatchObject({ status: "ready" });
		});

		it("checks every project environment before the first service teardown", async () => {
			await seedCopy();
			const environments = await db.query.environments.findMany({
				where: eq(schema.environments.projectId, a.projectId),
			});
			const ordered = [...environments].sort(
				(x, y) =>
					Number(x.environmentId === copyEnvironmentId) -
					Number(y.environmentId === copyEnvironmentId),
			);
			const lookup = vi.spyOn(db.query.environments, "findMany").mockResolvedValueOnce(ordered);
			try {
				await expect(teardown.deleteProjectCascade(a.projectId)).rejects.toMatchObject({
					code: "PRECONDITION_FAILED",
				});
				noEffects();
			} finally {
				lookup.mockRestore();
			}
		});

		it("refuses organization teardown before removing any certificate", async () => {
			await seedCopy();
			await db.insert(schema.certificates).values({
				organizationId: a.organizationId,
				name: "Cascade boundary",
				certificateData: "owned",
				privateKey: "owned",
				certificatePath: "/tmp/owned-cascade-certificate.crt",
				expiryAlerts: false,
			});
			await expect(teardown.deleteOrganizationCascade(a.organizationId)).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
			});
			noEffects();
		});

		it("protects the current target environment when a target moved out of its recorded environment", async () => {
			await seedCopy({ targetPostgresId: a.postgresId });
			await expect(guard({ environmentId: a.environmentId })).rejects.toMatchObject({
				code: "PRECONDITION_FAILED",
			});
			await expect(guard({ environmentId: b.environmentId })).resolves.toBeUndefined();
			noEffects();
		});

		it("foreign keys preserve tracking and targets if a copy appears after preflight", async () => {
			await guard({ environmentId: copyEnvironmentId });
			const copy = await seedCopy({ targetPostgresId: a.postgresId });
			await expect(
				db
					.delete(schema.environments)
					.where(eq(schema.environments.environmentId, copyEnvironmentId)),
			).rejects.toMatchObject({ cause: { code: "23503" } });
			await expect(
				db.delete(schema.organizations).where(eq(schema.organizations.id, a.organizationId)),
			).rejects.toMatchObject({ cause: { code: "23503" } });
			await expect(
				db.delete(schema.postgres).where(eq(schema.postgres.postgresId, a.postgresId)),
			).rejects.toMatchObject({ cause: { code: "23503" } });
			expect(
				await db.query.recoveryCopies.findFirst({
					where: eq(schema.recoveryCopies.recoveryCopyId, copy.recoveryCopyId),
				}),
			).toMatchObject({ targetPostgresId: a.postgresId });
		});

		it("reserves an orphaned copy name until its resources have been verified deleted", async () => {
			const { isAppNameTaken } = await import("../services/app-name");
			const name = `retained-copy-${randomUUID()}`;
			const copy = await seedCopy({ originAppName: name, targetPostgresId: null });
			expect(await isAppNameTaken(name)).toBe(true);
			await db
				.update(schema.recoveryCopies)
				.set({ status: "deleted" })
				.where(eq(schema.recoveryCopies.recoveryCopyId, copy.recoveryCopyId));
			expect(await isAppNameTaken(name)).toBe(false);
		});

		it("removes only verified-deleted history when deleting an empty environment", async () => {
			const [environment] = await db
				.insert(schema.environments)
				.values({ projectId: a.projectId, name: `deleted-history-${randomUUID()}` })
				.returning();
			if (!environment) throw new Error("Environment missing");
			const copy = await seedCopy({
				environmentId: environment.environmentId,
				status: "deleted",
				targetPostgresId: null,
			});
			await teardown.deleteEnvironmentCascade(environment.environmentId);
			expect(
				await db.query.environments.findFirst({
					where: eq(schema.environments.environmentId, environment.environmentId),
				}),
			).toBeUndefined();
			expect(
				await db.query.recoveryCopies.findFirst({
					where: and(
						eq(schema.recoveryCopies.organizationId, a.organizationId),
						eq(schema.recoveryCopies.recoveryCopyId, copy.recoveryCopyId),
					),
				}),
			).toBeUndefined();
			expect(effects.database).not.toHaveBeenCalled();
			expect(effects.network).toHaveBeenCalledWith(environment.environmentId);
		});
	},
);
