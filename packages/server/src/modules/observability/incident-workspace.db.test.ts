import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantFixture } from "../../trpc/tenancy.harness";

const transport = vi.hoisted(() => ({ rollback: vi.fn() }));
vi.mock("../application/rollback", () => ({ performApplicationRollback: transport.rollback }));

const testUrl = process.env.DATABASE_URL_TEST;

describe.skipIf(!testUrl)("incident workspace and recovery admission (postgres)", () => {
	let harness: typeof import("../../trpc/tenancy.harness");
	let db: typeof import("../../db")["db"];
	let schema: typeof import("../../db/schema");
	let workspace: typeof import("./incident-workspace");
	let incidents: typeof import("./index");
	let remediation: typeof import("../remediation");
	let scope: typeof import("../projects/project-scope");
	let orm: typeof import("drizzle-orm");
	let a: TenantFixture;
	let b: TenantFixture;

	beforeAll(async () => {
		process.env.DATABASE_URL = testUrl as string;
		harness = await import("../../trpc/tenancy.harness");
		({ db } = await import("../../db"));
		schema = await import("../../db/schema");
		workspace = await import("./incident-workspace");
		incidents = await import("./index");
		remediation = await import("../remediation");
		scope = await import("../projects/project-scope");
		orm = await import("drizzle-orm");
		({ a, b } = await harness.seedTwoTenants());
	}, 60_000);

	afterAll(async () => {
		if (a) await harness.wipeTenant(a);
		if (b) await harness.wipeTenant(b);
	});

	const file = async (
		tenant: TenantFixture,
		metadata: Record<string, unknown> = {},
		resolvedAt: Date | null = null,
		createdAt = new Date(),
	) => {
		const [row] = await db
			.insert(schema.incidents)
			.values({
				organizationId: tenant.organizationId,
				projectId: tenant.projectId,
				serviceId: tenant.applicationId,
				kind: metadata.proposal ? "remediation" : "deploy_failure",
				title: "Investigate service",
				serviceName: "Test service",
				createdAt,
				resolvedAt,
				metadata: { serviceKind: "application", ...metadata },
			})
			.returning();
		if (!row) throw new Error("Incident seed failed");
		return row;
	};
	const proposal = {
		rule: "restart_loop",
		reason: "Repeated task failures",
		title: "Restore previous image",
		action: {
			type: "rollback_application",
			rollbackId: "test-pin",
			image: "redis:8",
			deploymentId: null,
		},
	};
	const deployment = async (status: "queued" | "done" = "queued") => {
		const [row] = await db
			.insert(schema.deployments)
			.values({
				applicationId: a.applicationId,
				title: "Recovery",
				status,
				logPath: "/nonexistent/incident-recovery.log",
			})
			.returning();
		if (!row) throw new Error("Deployment seed failed");
		return row;
	};

	it("finds older open incidents and pages equal-time incidents without losing rows", async () => {
		const createdAt = new Date("2026-10-20T12:00:00Z");
		const open = await file(a, {}, null, new Date(createdAt.getTime() - 1));
		for (let index = 0; index < 111; index++) await file(a, {}, new Date(), createdAt);
		await file(b);
		const needsAttention = await workspace.listIncidentPage(a.organizationId, {
			state: "open",
			limit: 1,
		});
		expect(needsAttention.openCount).toBe(1);
		expect(needsAttention.incidents.map((row) => row.incidentId)).toEqual([open.incidentId]);
		const ids: string[] = [];
		let cursor: string | null = null;
		for (let count = 0; count < 10; count++) {
			const page = await workspace.listIncidentPage(a.organizationId, {
				state: "all",
				limit: 17,
				cursor,
			});
			ids.push(...page.incidents.map((row) => row.incidentId));
			cursor = page.nextCursor;
			if (!cursor) break;
		}
		expect(cursor).toBeNull();
		expect(ids).toHaveLength(112);
		expect(new Set(ids).size).toBe(112);
		await expect(
			workspace.listIncidentPage(a.organizationId, { cursor: "invalid" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("refuses recovery when its service moved outside the incident's visible project", async () => {
		const scoped = await harness.seedTeamScopedMember(a);
		try {
			for (const kind of ["application", "compose"] as const) {
				const serviceId = kind === "application" ? a.applicationId : a.composeId;
				const action =
					kind === "application"
						? proposal.action
						: { type: "rollback_compose", snapshotId: "not-loaded", deploymentId: "not-loaded" };
				const row = await file(a, { proposal: { ...proposal, action } });
				await db
					.update(schema.incidents)
					.set({ serviceId })
					.where(orm.eq(schema.incidents.incidentId, row.incidentId));
				const table = kind === "application" ? schema.applications : schema.compose;
				const id =
					kind === "application" ? schema.applications.applicationId : schema.compose.composeId;
				await db
					.update(table)
					.set({ environmentId: scoped.otherEnvironmentId })
					.where(orm.eq(id, serviceId));
				try {
					await scope.runWithProjectFilter(
						{ kind: "projects", projectIds: new Set([a.projectId]) },
						async () => {
							await expect(
								remediation.applyRemediation({
									incidentId: row.incidentId,
									organizationId: a.organizationId,
									userId: scoped.userId,
								}),
							).rejects.toMatchObject({ code: "NOT_FOUND" });
						},
					);
					expect(
						(
							await db.query.incidents.findFirst({
								where: orm.eq(schema.incidents.incidentId, row.incidentId),
							})
						)?.metadata?.proposal,
					).not.toHaveProperty("operation");
				} finally {
					await db
						.update(table)
						.set({ environmentId: a.environmentId })
						.where(orm.eq(id, serviceId));
				}
			}
		} finally {
			await harness.wipeTeamScopedMember(scoped);
		}
	});

	it("uses the successful Compose snapshot's merged variables and explicit null build args for recovery", async () => {
		const [previous] = await db
			.insert(schema.deployments)
			.values({
				composeId: a.composeId,
				title: "Approved Compose",
				status: "done",
				logPath: "/nonexistent/approved.log",
			})
			.returning();
		if (!previous) throw new Error("Previous deployment missing");
		const { recordComposeSnapshot } = await import("../compose/snapshot");
		await recordComposeSnapshot({
			composeId: a.composeId,
			deploymentId: previous.deploymentId,
			sourceFile: "services:\n  web:\n    image: nginx:alpine\n",
			renderedFile: "services:\n  web:\n    image: nginx:alpine\n",
			serviceEnv: "SERVICE=approved",
			mergedEnv: "SHARED=approved\nSERVICE=approved",
		});
		const [snapshot] = await db
			.select()
			.from(schema.composeDeploymentSnapshots)
			.where(orm.eq(schema.composeDeploymentSnapshots.deploymentId, previous.deploymentId));
		if (!snapshot) throw new Error("Compose snapshot missing");
		await db.insert(schema.deploymentEnvironmentSnapshots).values({
			deploymentId: previous.deploymentId,
			runtimeEnv: "SHARED=approved\nSERVICE=approved",
			serviceEnv: "SERVICE=approved",
			buildArgs: null,
			sourceFingerprint: "fixture",
		});
		await db
			.update(schema.projects)
			.set({ env: "SHARED=unapproved" })
			.where(orm.eq(schema.projects.projectId, a.projectId));
		await db
			.update(schema.compose)
			.set({ buildArgs: "UNAPPROVED_BUILD_ARG=yes" })
			.where(orm.eq(schema.compose.composeId, a.composeId));
		const row = await file(a, {
			serviceKind: "compose",
			proposal: {
				...proposal,
				action: {
					type: "rollback_compose",
					snapshotId: snapshot.snapshotId,
					deploymentId: previous.deploymentId,
				},
			},
		});
		await db
			.update(schema.incidents)
			.set({ serviceId: a.composeId })
			.where(orm.eq(schema.incidents.incidentId, row.incidentId));
		const result = await remediation.applyRemediation({
			incidentId: row.incidentId,
			organizationId: a.organizationId,
			userId: a.userId,
		});
		const captured = await db.query.deploymentEnvironmentSnapshots.findFirst({
			where: orm.eq(schema.deploymentEnvironmentSnapshots.deploymentId, result.deploymentId),
		});
		expect(captured).toMatchObject({
			runtimeEnv: "SHARED=approved\nSERVICE=approved",
			serviceEnv: "SERVICE=approved",
			buildArgs: null,
		});
		expect(
			(
				await db.query.incidents.findFirst({
					where: orm.eq(schema.incidents.incidentId, row.incidentId),
				})
			)?.resolvedAt,
		).toBeNull();
	});

	it("hides project incidents and foreign deployment references", async () => {
		const row = await file(a);
		await scope.runWithProjectFilter({ kind: "projects", projectIds: new Set() }, async () => {
			expect(
				(await workspace.listIncidentPage(a.organizationId, { state: "all" })).incidents,
			).toEqual([]);
			expect((await workspace.listIncidentPage(a.organizationId, { state: "all" })).openCount).toBe(
				0,
			);
			await expect(
				workspace.getIncidentWorkspace(row.incidentId, a.organizationId),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
			await expect(
				incidents.acknowledgeIncident({
					incidentId: row.incidentId,
					organizationId: a.organizationId,
					userId: a.userId,
				}),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});
		await expect(
			workspace.getIncidentWorkspace(row.incidentId, b.organizationId),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		const [foreign] = await db
			.insert(schema.deployments)
			.values({
				applicationId: b.applicationId,
				title: "Foreign",
				status: "error",
				logPath: "/nonexistent/foreign.log",
			})
			.returning();
		const linked = await file(a, { deploymentId: foreign?.deploymentId });
		expect(
			(await workspace.getIncidentWorkspace(linked.incidentId, a.organizationId)).sourceDeployment,
		).toBeNull();
	});

	it("admits one competing recovery and keeps queued/running/failed outcomes open", async () => {
		const row = await file(a, { proposal });
		const queued = await deployment();
		let release!: () => void;
		let entered!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		transport.rollback.mockReset().mockImplementation(async () => {
			entered();
			await pending;
			return { deployment: queued };
		});
		const input = {
			incidentId: row.incidentId,
			organizationId: a.organizationId,
			userId: a.userId,
		};
		const attempts = [0, 1].map(() =>
			remediation.applyRemediation(input).then(
				(value) => ({ ok: true as const, value }),
				(error: unknown) => ({ ok: false as const, error }),
			),
		);
		await started;
		const loser = await Promise.race(attempts);
		expect(loser.ok).toBe(false);
		if (!loser.ok) expect(loser.error).toMatchObject({ code: "PRECONDITION_FAILED" });
		await expect(remediation.dismissRemediation(input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		await expect(incidents.resolveIncident({ ...input, note: "Too early" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		release();
		expect((await Promise.all(attempts)).filter((attempt) => attempt.ok)).toHaveLength(1);
		expect(transport.rollback).toHaveBeenCalledTimes(1);
		let view = await workspace.getIncidentWorkspace(row.incidentId, a.organizationId);
		expect(view.recovery?.state).toBe("queued");
		expect(view.incident.resolvedAt).toBeNull();
		await db
			.update(schema.deployments)
			.set({ status: "running" })
			.where(orm.eq(schema.deployments.deploymentId, queued.deploymentId));
		expect(
			(await workspace.getIncidentWorkspace(row.incidentId, a.organizationId)).recovery?.state,
		).toBe("running");
		await expect(incidents.resolveIncident({ ...input, note: "Too early" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await db
			.update(schema.deployments)
			.set({ status: "error", errorMessage: "Recovery did not converge" })
			.where(orm.eq(schema.deployments.deploymentId, queued.deploymentId));
		view = await workspace.getIncidentWorkspace(row.incidentId, a.organizationId);
		expect(view.recovery?.state).toBe("failed");
		expect(view.incident.resolvedAt).toBeNull();
		await expect(incidents.resolveIncident(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(
			(
				await incidents.resolveIncident({
					...input,
					note: "Manually restored and checked the route",
				})
			).resolvedAt,
		).not.toBeNull();
	});

	it("records completion without asserting health and preserves failed admission", async () => {
		const row = await file(a, { proposal });
		transport.rollback.mockReset().mockResolvedValue({ deployment: await deployment("done") });
		const input = {
			incidentId: row.incidentId,
			organizationId: a.organizationId,
			userId: a.userId,
		};
		await remediation.applyRemediation(input);
		const view = await workspace.getIncidentWorkspace(row.incidentId, a.organizationId);
		expect(view.recovery?.state).toBe("completed");
		expect(view.incident.resolvedAt).toBeNull();
		expect(
			(await incidents.resolveIncident({ ...input, note: "Confirmed a successful request" }))
				.resolvedAt,
		).not.toBeNull();
		const failed = await file(a, { proposal });
		transport.rollback.mockRejectedValue(new Error("Transport unavailable"));
		const failedInput = { ...input, incidentId: failed.incidentId };
		await expect(remediation.applyRemediation(failedInput)).rejects.toThrow(
			"Transport unavailable",
		);
		const failure = await workspace.getIncidentWorkspace(failed.incidentId, a.organizationId);
		expect(failure.recovery?.state).toBe("failed");
		expect(failure.incident.resolvedAt).toBeNull();
		await expect(remediation.applyRemediation(failedInput)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
	});
	it("keeps an interrupted admission inspectable without retrying its side effect", async () => {
		const row = await file(a, {
			proposal: {
				...proposal,
				operation: {
					state: "applying",
					startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
					appliedBy: a.userId,
				},
			},
		});
		const input = {
			incidentId: row.incidentId,
			organizationId: a.organizationId,
			userId: a.userId,
		};
		expect(
			(await workspace.getIncidentWorkspace(row.incidentId, a.organizationId)).recovery?.state,
		).toBe("unknown");
		await expect(remediation.applyRemediation(input)).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(
			(
				await incidents.resolveIncident({
					...input,
					note: "Manually checked the running service after the interruption",
				})
			).resolvedAt,
		).not.toBeNull();
	});

	it("does not let a racing manual resolution overwrite recovery admission", async () => {
		for (let attempt = 0; attempt < 5; attempt++) {
			const row = await file(a, { proposal });
			transport.rollback.mockReset().mockResolvedValue({ deployment: await deployment() });
			const input = {
				incidentId: row.incidentId,
				organizationId: a.organizationId,
				userId: a.userId,
			};
			const result = await Promise.allSettled([
				remediation.applyRemediation(input),
				incidents.resolveIncident({ ...input, note: "Checked before competing recovery" }),
			]);
			expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
			const view = await workspace.getIncidentWorkspace(row.incidentId, a.organizationId);
			if (transport.rollback.mock.calls.length > 0) {
				expect(view.incident.resolvedAt).toBeNull();
				expect(view.recovery?.state).toBe("queued");
			} else {
				expect(view.incident.resolvedAt).not.toBeNull();
				expect(view.recovery).toBeNull();
			}
		}
	});
	it("preserves PostgreSQL microseconds when paging database-default incident timestamps", async () => {
		const [project] = await db
			.insert(schema.projects)
			.values({ name: "Microsecond scope", organizationId: a.organizationId })
			.returning();
		if (!project) throw new Error("Project seed failed");
		await db.insert(schema.incidents).values(
			Array.from({ length: 41 }, () => ({
				organizationId: a.organizationId,
				projectId: project.projectId,
				kind: "test",
				title: "Same database instant",
			})),
		);
		const seen: string[] = [];
		let cursor: string | null = null;
		for (let attempt = 0; attempt < 10; attempt++) {
			const page = await workspace.listIncidentPage(a.organizationId, {
				projectId: project.projectId,
				state: "all",
				limit: 7,
				cursor,
			});
			seen.push(...page.incidents.map((row) => row.incidentId));
			cursor = page.nextCursor;
			if (!cursor) break;
		}
		expect(seen).toHaveLength(41);
		expect(new Set(seen).size).toBe(41);
		await db.delete(schema.incidents).where(orm.eq(schema.incidents.projectId, project.projectId));
		await db.delete(schema.projects).where(orm.eq(schema.projects.projectId, project.projectId));
	});
});
