import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { applications, compose, environments, projects, schedules, servers } from "../../db/schema";
import { assertApplicationAccess } from "../../modules/application";
import { findServerById } from "../../modules/cluster";
import { findComposeForOrg } from "../../modules/compose/service";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import {
	getScheduleRunState,
	isValidCron,
	registerSchedule,
	runSchedule,
	type ScheduleRow,
	unregisterSchedule,
} from "../../modules/schedules";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

/**
 * Cron schedules: shell commands/scripts run in a service container or on a
 * server. Org scoping follows the schedule's target
 * (application/compose → environment → project → organization; server → org;
 * nixploy-server schedules are per-user on the instance).
 */

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Verify the caller may manage a schedule targeting the given resource. */
async function assertTargetAccess(
	session: Session,
	target: {
		scheduleType: "application" | "compose" | "server" | "nixploy-server";
		applicationId?: string | null;
		composeId?: string | null;
		serverId?: string | null;
	},
): Promise<void> {
	switch (target.scheduleType) {
		case "application": {
			if (!target.applicationId) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "applicationId is required" });
			}
			const organizationId = await getOrganizationId(session);
			await assertApplicationAccess(target.applicationId, organizationId);
			return;
		}
		case "compose": {
			if (!target.composeId) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "composeId is required" });
			}
			const organizationId = await getOrganizationId(session);
			await findComposeForOrg(target.composeId, organizationId);
			return;
		}
		case "server": {
			if (!target.serverId) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "serverId is required" });
			}
			const organizationId = await getOrganizationId(session);
			const server = await findServerById(target.serverId, organizationId);
			if (!server) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Server not found" });
			}
			// Runs arbitrary shell on the host over SSH — infrastructure-level.
			await assertCapability(session.user.id, organizationId, "schedules.manage");
			return;
		}
		case "nixploy-server": {
			// Runs arbitrary shell inside the Nixploy process itself, so it is
			// effectively instance root: admins only, ownership by userId below.
			const organizationId = await getOrganizationId(session);
			await assertCapability(session.user.id, organizationId, "schedules.manage");
			return;
		}
	}
}

/** Verify the caller may manage this schedule row. */
async function assertScheduleAccess(session: Session, row: ScheduleRow): Promise<void> {
	if (row.scheduleType === "nixploy-server") {
		if (row.userId !== session.user.id) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
		}
		// Still admin-only: a demoted member keeps no host-shell access.
		const organizationId = await getOrganizationId(session);
		await assertCapability(session.user.id, organizationId, "schedules.manage");
		return;
	}
	await assertTargetAccess(session, row);
}

async function findScheduleOrThrow(scheduleId: string): Promise<ScheduleRow> {
	const row = await db.query.schedules.findFirst({
		where: eq(schedules.scheduleId, scheduleId),
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
	}
	return row;
}

const withRunState = (row: ScheduleRow) => ({
	...row,
	...getScheduleRunState(row.scheduleId),
});

const scheduleTypeSchema = z.enum(["application", "compose", "server", "nixploy-server"]);

const targetInput = {
	scheduleType: scheduleTypeSchema,
	appName: z.string().nullish(),
	applicationId: z.string().nullish(),
	composeId: z.string().nullish(),
	serverId: z.string().nullish(),
};

export const scheduleRouter = router({
	/**
	 * Every schedule visible in the caller's organization (service/server
	 * targets) plus this user's nixploy-server schedules.
	 */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const orgProjects = await db.query.projects.findMany({
			where: eq(projects.organizationId, organizationId),
			columns: { projectId: true },
		});
		const projectIds = orgProjects.map((row) => row.projectId);
		const environmentRows =
			projectIds.length > 0
				? await db.query.environments.findMany({
						where: inArray(environments.projectId, projectIds),
						columns: { environmentId: true },
					})
				: [];
		const envIds = environmentRows.map((row) => row.environmentId);

		const [applicationIds, composeIds, orgServers] = await Promise.all([
			envIds.length > 0
				? db.query.applications.findMany({
						where: inArray(applications.environmentId, envIds),
						columns: { applicationId: true, name: true, appName: true },
					})
				: Promise.resolve([]),
			envIds.length > 0
				? db.query.compose.findMany({
						where: inArray(compose.environmentId, envIds),
						columns: { composeId: true, name: true, appName: true },
					})
				: Promise.resolve([]),
			db.query.servers.findMany({
				where: eq(servers.organizationId, organizationId),
				columns: { serverId: true, name: true },
			}),
		]);

		const appIdSet = new Set(applicationIds.map((row) => row.applicationId));
		const composeIdSet = new Set(composeIds.map((row) => row.composeId));
		const serverIdSet = new Set(orgServers.map((row) => row.serverId));
		const appNameById = new Map(applicationIds.map((row) => [row.applicationId, row.name]));
		const composeNameById = new Map(composeIds.map((row) => [row.composeId, row.name]));
		const serverNameById = new Map(orgServers.map((row) => [row.serverId, row.name]));

		const rows = await db.query.schedules.findMany({
			orderBy: (table, { desc }) => [desc(table.createdAt)],
		});

		return rows
			.filter((row) => {
				if (row.scheduleType === "nixploy-server") {
					return row.userId === ctx.session.user.id;
				}
				if (row.scheduleType === "application" && row.applicationId) {
					return appIdSet.has(row.applicationId);
				}
				if (row.scheduleType === "compose" && row.composeId) {
					return composeIdSet.has(row.composeId);
				}
				if (row.scheduleType === "server" && row.serverId) {
					return serverIdSet.has(row.serverId);
				}
				return false;
			})
			.map((row) => ({
				...withRunState(row),
				targetName:
					row.scheduleType === "application" && row.applicationId
						? (appNameById.get(row.applicationId) ?? row.appName ?? row.applicationId)
						: row.scheduleType === "compose" && row.composeId
							? (composeNameById.get(row.composeId) ?? row.appName ?? row.composeId)
							: row.scheduleType === "server" && row.serverId
								? (serverNameById.get(row.serverId) ?? row.serverId)
								: "This Nixploy host",
			}));
	}),

	/** Schedules of one target service/server (with live run state). */
	byService: protectedProcedure
		.input(
			z.object({
				serviceId: z.string().min(1),
				serviceType: scheduleTypeSchema,
			}),
		)
		.query(async ({ ctx, input }) => {
			if (input.serviceType === "nixploy-server") {
				const rows = await db.query.schedules.findMany({
					where: and(
						eq(schedules.scheduleType, "nixploy-server"),
						eq(schedules.userId, ctx.session.user.id),
					),
				});
				return rows.map(withRunState);
			}

			await assertTargetAccess(ctx.session, {
				scheduleType: input.serviceType,
				applicationId: input.serviceType === "application" ? input.serviceId : null,
				composeId: input.serviceType === "compose" ? input.serviceId : null,
				serverId: input.serviceType === "server" ? input.serviceId : null,
			});

			const column =
				input.serviceType === "application"
					? schedules.applicationId
					: input.serviceType === "compose"
						? schedules.composeId
						: schedules.serverId;
			const rows = await db.query.schedules.findMany({
				where: and(eq(schedules.scheduleType, input.serviceType), eq(column, input.serviceId)),
			});
			return rows.map(withRunState);
		}),

	/** A single schedule (with live run state). */
	one: protectedProcedure
		.input(z.object({ scheduleId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const row = await findScheduleOrThrow(input.scheduleId);
			await assertScheduleAccess(ctx.session, row);
			return withRunState(row);
		}),

	/** Create and (when enabled) register a cron schedule. */
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				cronExpression: z.string().min(1),
				shellType: z.enum(["bash", "sh"]).optional(),
				command: z.string().min(1),
				script: z.string().nullish(),
				enabled: z.boolean().optional(),
				...targetInput,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!isValidCron(input.cronExpression)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid cron expression: ${input.cronExpression}`,
				});
			}
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "schedules.manage");
			await assertTargetAccess(ctx.session, input);
			const [row] = await db
				.insert(schedules)
				.values({
					name: input.name,
					cronExpression: input.cronExpression,
					shellType: input.shellType ?? "bash",
					command: input.command,
					script: input.script ?? null,
					enabled: input.enabled ?? true,
					scheduleType: input.scheduleType,
					appName: input.appName ?? null,
					applicationId: input.applicationId ?? null,
					composeId: input.composeId ?? null,
					serverId: input.serverId ?? null,
					userId: ctx.session.user.id,
				})
				.returning();
			if (!row) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}
			registerSchedule(row);
			return row;
		}),

	/** Update a schedule; the cron job is re-registered. */
	update: protectedProcedure
		.input(
			z.object({
				scheduleId: z.string().min(1),
				name: z.string().min(1).optional(),
				cronExpression: z.string().min(1).optional(),
				shellType: z.enum(["bash", "sh"]).optional(),
				command: z.string().min(1).optional(),
				script: z.string().nullish(),
				appName: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "schedules.manage");
			const row = await findScheduleOrThrow(input.scheduleId);
			await assertScheduleAccess(ctx.session, row);
			if (input.cronExpression && !isValidCron(input.cronExpression)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Invalid cron expression: ${input.cronExpression}`,
				});
			}
			const { scheduleId, ...values } = input;
			const [updated] = await db
				.update(schedules)
				.set(values)
				.where(eq(schedules.scheduleId, scheduleId))
				.returning();
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
			}
			registerSchedule(updated);
			return updated;
		}),

	/** Delete a schedule and cancel its cron job. */
	remove: protectedProcedure
		.input(z.object({ scheduleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "schedules.manage");
			const row = await findScheduleOrThrow(input.scheduleId);
			await assertScheduleAccess(ctx.session, row);
			unregisterSchedule(row.scheduleId);
			await db.delete(schedules).where(eq(schedules.scheduleId, row.scheduleId));
			return true;
		}),

	/** Execute the schedule immediately (errors propagate to the caller). */
	runManually: protectedProcedure
		.input(z.object({ scheduleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "schedules.manage");
			const row = await findScheduleOrThrow(input.scheduleId);
			await assertScheduleAccess(ctx.session, row);
			return await runSchedule(row, "manual");
		}),

	/** Enable and register the cron job. */
	enable: protectedProcedure
		.input(z.object({ scheduleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "schedules.manage");
			const row = await findScheduleOrThrow(input.scheduleId);
			await assertScheduleAccess(ctx.session, row);
			const [updated] = await db
				.update(schedules)
				.set({ enabled: true })
				.where(eq(schedules.scheduleId, row.scheduleId))
				.returning();
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
			}
			registerSchedule(updated);
			return updated;
		}),

	/** Disable and cancel the cron job. */
	disable: protectedProcedure
		.input(z.object({ scheduleId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "schedules.manage");
			const row = await findScheduleOrThrow(input.scheduleId);
			await assertScheduleAccess(ctx.session, row);
			unregisterSchedule(row.scheduleId);
			const [updated] = await db
				.update(schedules)
				.set({ enabled: false })
				.where(eq(schedules.scheduleId, row.scheduleId))
				.returning();
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Schedule not found" });
			}
			return updated;
		}),
});
