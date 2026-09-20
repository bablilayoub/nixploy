/**
 * The remediation rule pass against a real Postgres: the grouped
 * `service_event` query, the one-open / cooldown / deploying guards and the
 * incident it files. Requires `DATABASE_URL_TEST`; skips when unset, like
 * every other `*.db.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("remediation rule pass (postgres)", () => {
	let harness: typeof import("../../trpc/tenancy.harness");
	let dbModule: typeof import("../../db");
	let schema: typeof import("../../db/schema");
	let remediation: typeof import("./index");
	let drizzle: typeof import("drizzle-orm");
	let tenant: TenantFixture;

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		delete process.env.NIXPLOY_REMEDIATION;
		harness = await import("../../trpc/tenancy.harness");
		dbModule = await import("../../db");
		schema = await import("../../db/schema");
		remediation = await import("./index");
		drizzle = await import("drizzle-orm");
		tenant = await harness.seedOneTenant("remed");
	}, 60_000);

	afterAll(async () => {
		delete process.env.NIXPLOY_REMEDIATION;
		if (tenant) await harness.wipeTenant(tenant);
	});

	const failures = async (
		serviceType: "application" | "compose",
		serviceId: string,
		count: number,
		kind: "task_failed" | "oom_killed" = "task_failed",
	) => {
		await dbModule.db.insert(schema.serviceEvents).values(
			Array.from({ length: count }, (_, index) => ({
				organizationId: tenant.organizationId,
				serviceType,
				serviceId,
				appName: `${serviceType}-remed`,
				kind,
				severity: "error",
				title: `Task failed ${index}`,
				dedupeKey: `test:${serviceId}:${kind}:${index}:${Math.random()}`,
				occurredAt: new Date(Date.now() - index * 1000),
			})),
		);
	};

	const proposalsFor = async (serviceId: string) =>
		dbModule.db.query.incidents.findMany({
			where: drizzle.and(
				drizzle.eq(schema.incidents.serviceId, serviceId),
				drizzle.eq(schema.incidents.kind, remediation.REMEDIATION_INCIDENT_KIND),
			),
			orderBy: drizzle.desc(schema.incidents.createdAt),
		});

	it("does nothing while the kill switch is set", async () => {
		process.env.NIXPLOY_REMEDIATION = "0";
		await failures("application", tenant.applicationId, 3);
		await expect(remediation.proposeRemediations()).resolves.toEqual({
			candidates: 0,
			proposed: 0,
		});
		delete process.env.NIXPLOY_REMEDIATION;
	});

	it("proposes a rollback to the pin before the current one, once", async () => {
		// Two pins: the newer is what runs now, the older is the target.
		const older = (
			await dbModule.db
				.insert(schema.rollbacks)
				.values({
					image: "app-remed:older",
					applicationId: tenant.applicationId,
					createdAt: new Date(Date.now() - 60_000),
				})
				.returning()
		)[0];
		await dbModule.db.insert(schema.rollbacks).values({
			image: "app-remed:current",
			applicationId: tenant.applicationId,
			createdAt: new Date(),
		});

		const first = await remediation.proposeRemediations();
		expect(first.candidates).toBeGreaterThanOrEqual(1);
		expect(first.proposed).toBe(1);
		const [incident] = await proposalsFor(tenant.applicationId);
		expect(incident).toBeDefined();
		expect(incident?.resolvedAt).toBeNull();
		expect(incident?.severity).toBe("warning");
		expect(incident?.metadata?.serviceKind).toBe("application");
		const proposal = incident?.metadata?.proposal as { action: Record<string, unknown> };
		expect(proposal.action).toMatchObject({
			type: "rollback_application",
			rollbackId: older?.rollbackId,
			image: "app-remed:older",
		});

		// One open proposal per service: the same failures do not file another.
		const second = await remediation.proposeRemediations();
		expect(second.proposed).toBe(0);
		expect(await proposalsFor(tenant.applicationId)).toHaveLength(1);
	});

	it("dismissing closes the proposal and starts the cooldown", async () => {
		const [incident] = await proposalsFor(tenant.applicationId);
		if (!incident) throw new Error("no proposal to dismiss");
		await remediation.dismissRemediation({
			incidentId: incident.incidentId,
			organizationId: tenant.organizationId,
			userId: tenant.userId,
		});
		const [closed] = await proposalsFor(tenant.applicationId);
		expect(closed?.resolvedAt).not.toBeNull();
		expect(closed?.metadata?.resolutionNote).toBe("Dismissed");
		expect((closed?.metadata?.proposal as Record<string, unknown>).dismissedBy).toBe(tenant.userId);

		// Still failing, but inside the cooldown: quiet.
		await failures("application", tenant.applicationId, 3);
		expect((await remediation.proposeRemediations()).proposed).toBe(0);

		// A closed proposal cannot be applied or dismissed again.
		await expect(
			remediation.applyRemediation({
				incidentId: incident.incidentId,
				organizationId: tenant.organizationId,
				userId: tenant.userId,
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		// Nor seen from another organization.
		await expect(
			remediation.dismissRemediation({
				incidentId: incident.incidentId,
				organizationId: "someone-else",
				userId: tenant.userId,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("stays quiet while a deployment is in flight, then explains an OOM loop without a button", async () => {
		await failures("compose", tenant.composeId, 3, "oom_killed");
		const [queued] = await dbModule.db
			.insert(schema.deployments)
			.values({
				title: "Deploy",
				status: "queued",
				logPath: "/tmp/remed-queued.log",
				composeId: tenant.composeId,
				appName: "compose-remed",
				startedAt: new Date(),
			})
			.returning();
		expect((await remediation.proposeRemediations()).proposed).toBe(0);
		await dbModule.db
			.delete(schema.deployments)
			.where(drizzle.eq(schema.deployments.deploymentId, queued?.deploymentId ?? ""));

		expect((await remediation.proposeRemediations()).proposed).toBe(1);
		const [incident] = await proposalsFor(tenant.composeId);
		expect(incident?.severity).toBe("error");
		expect(incident?.title).toMatch(/out of memory/);
		const proposal = incident?.metadata?.proposal as { action: { type: string } };
		expect(proposal.action.type).toBe("none");
		await expect(
			remediation.applyRemediation({
				incidentId: incident?.incidentId ?? "",
				organizationId: tenant.organizationId,
				userId: tenant.userId,
			}),
		).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});
