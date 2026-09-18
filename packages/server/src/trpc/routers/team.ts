import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { members, projects, teamMembers, teamProjects, teams, users } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import {
	assertCapability,
	PROJECT_SCOPES,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/**
 * Teams: which projects a member may reach.
 *
 * Managing them is `members.manage` — the same capability that edits a
 * member's capability overlay, because this is the same kind of decision about
 * the same people, and it is rank-bound to admin already.
 *
 * Every read and write here resolves the organization first and filters by it.
 * These procedures deliberately do **not** go through the project filter
 * themselves: an admin editing teams has to be able to see the projects they
 * are assigning, and `members.manage` is admin-only, which is a strictly
 * higher bar than being in a team.
 */

const teamIdInput = z.object({ teamId: z.string().min(1) });

/** Load a team and verify it belongs to the caller's organization. */
async function findTeam(teamId: string, organizationId: string) {
	const team = await db.query.teams.findFirst({
		where: and(eq(teams.teamId, teamId), eq(teams.organizationId, organizationId)),
	});
	if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found" });
	return team;
}

/** Everyone in the organization, so the panel can offer them. */
async function organizationMemberIds(organizationId: string): Promise<Set<string>> {
	const rows = await db
		.select({ userId: members.userId })
		.from(members)
		.where(eq(members.organizationId, organizationId));
	return new Set(rows.map((row) => row.userId));
}

export const teamRouter = router({
	/** Teams of the active organization, with their members and projects. */
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "members.manage");

		const rows = await db.query.teams.findMany({
			where: eq(teams.organizationId, organizationId),
			orderBy: (team, { asc }) => asc(team.name),
		});
		if (rows.length === 0) return [];
		const teamIds = rows.map((row) => row.teamId);

		const [memberRows, projectRows] = await Promise.all([
			db
				.select({
					teamId: teamMembers.teamId,
					userId: teamMembers.userId,
					name: users.name,
					email: users.email,
				})
				.from(teamMembers)
				.innerJoin(users, eq(users.id, teamMembers.userId))
				.where(inArray(teamMembers.teamId, teamIds)),
			db
				.select({
					teamId: teamProjects.teamId,
					projectId: teamProjects.projectId,
					name: projects.name,
				})
				.from(teamProjects)
				.innerJoin(projects, eq(projects.projectId, teamProjects.projectId))
				.where(inArray(teamProjects.teamId, teamIds)),
		]);

		return rows.map((team) => ({
			...team,
			members: memberRows
				.filter((row) => row.teamId === team.teamId)
				.map(({ userId, name, email }) => ({ userId, name, email })),
			projects: projectRows
				.filter((row) => row.teamId === team.teamId)
				.map(({ projectId, name }) => ({ projectId, name })),
		}));
	}),

	/**
	 * Everyone in the organization with their project scope.
	 *
	 * Deliberately separate from better-auth's member list: `project_scope` is
	 * a Nixploy column, and the panel needs it next to the role to explain what
	 * a team actually changes for a given person.
	 */
	memberScopes: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "members.manage");

		return db
			.select({
				userId: members.userId,
				role: members.role,
				projectScope: members.projectScope,
				name: users.name,
				email: users.email,
			})
			.from(members)
			.innerJoin(users, eq(users.id, members.userId))
			.where(eq(members.organizationId, organizationId))
			.orderBy(users.name);
	}),

	create: protectedProcedure
		.input(
			z.object({ name: z.string().min(1).max(80), description: z.string().max(300).nullish() }),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");

			const existing = await db.query.teams.findFirst({
				where: and(eq(teams.organizationId, organizationId), eq(teams.name, input.name)),
			});
			if (existing) {
				throw new TRPCError({ code: "CONFLICT", message: "A team with that name already exists" });
			}
			const [team] = await db
				.insert(teams)
				.values({
					organizationId,
					name: input.name,
					description: input.description ?? null,
				})
				.returning();
			if (!team) {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create team" });
			}
			void auditFromSession(ctx, organizationId, {
				action: "team.create",
				targetType: "team",
				targetId: team.teamId,
				targetName: team.name,
			});
			return team;
		}),

	update: protectedProcedure
		.input(
			teamIdInput.extend({
				name: z.string().min(1).max(80).optional(),
				description: z.string().max(300).nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");
			const team = await findTeam(input.teamId, organizationId);

			const [updated] = await db
				.update(teams)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.description !== undefined ? { description: input.description } : {}),
					updatedAt: new Date(),
				})
				.where(eq(teams.teamId, team.teamId))
				.returning();
			void auditFromSession(ctx, organizationId, {
				action: "team.update",
				targetType: "team",
				targetId: team.teamId,
				targetName: updated?.name ?? team.name,
			});
			return updated ?? team;
		}),

	delete: protectedProcedure.input(teamIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		await assertCapability(ctx.session.user.id, organizationId, "members.manage");
		const team = await findTeam(input.teamId, organizationId);

		// Deleting a team takes its projects away from every member scoped to
		// teams — which is the intent, but worth saying out loud in the audit
		// row, because the effect is invisible until someone cannot find a
		// project any more.
		const affected = await db
			.select({ userId: teamMembers.userId })
			.from(teamMembers)
			.where(eq(teamMembers.teamId, team.teamId));

		await db.delete(teams).where(eq(teams.teamId, team.teamId));
		void auditFromSession(ctx, organizationId, {
			action: "team.delete",
			targetType: "team",
			targetId: team.teamId,
			targetName: team.name,
			metadata: { members: affected.length },
		});
		return { teamId: team.teamId };
	}),

	/** Replace the team's member list. */
	setMembers: protectedProcedure
		.input(teamIdInput.extend({ userIds: z.array(z.string().min(1)).max(500) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");
			const team = await findTeam(input.teamId, organizationId);

			// Only people who are already in the organization: a team is a subset
			// of the membership, never a way into it.
			const allowed = await organizationMemberIds(organizationId);
			const userIds = [...new Set(input.userIds)].filter((userId) => allowed.has(userId));

			await db.transaction(async (tx) => {
				await tx.delete(teamMembers).where(eq(teamMembers.teamId, team.teamId));
				if (userIds.length > 0) {
					await tx
						.insert(teamMembers)
						.values(userIds.map((userId) => ({ teamId: team.teamId, userId })));
				}
			});
			void auditFromSession(ctx, organizationId, {
				action: "team.setMembers",
				targetType: "team",
				targetId: team.teamId,
				targetName: team.name,
				metadata: { members: userIds.length },
			});
			return { teamId: team.teamId, userIds };
		}),

	/** Replace the projects this team may reach. */
	setProjects: protectedProcedure
		.input(teamIdInput.extend({ projectIds: z.array(z.string().min(1)).max(500) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");
			const team = await findTeam(input.teamId, organizationId);

			// Projects of this organization only — otherwise a team would be a way
			// to hand out access across tenants.
			const owned = await db
				.select({ projectId: projects.projectId })
				.from(projects)
				.where(eq(projects.organizationId, organizationId));
			const ownedIds = new Set(owned.map((row) => row.projectId));
			const projectIds = [...new Set(input.projectIds)].filter((projectId) =>
				ownedIds.has(projectId),
			);

			await db.transaction(async (tx) => {
				await tx.delete(teamProjects).where(eq(teamProjects.teamId, team.teamId));
				if (projectIds.length > 0) {
					await tx
						.insert(teamProjects)
						.values(projectIds.map((projectId) => ({ teamId: team.teamId, projectId })));
				}
			});
			void auditFromSession(ctx, organizationId, {
				action: "team.setProjects",
				targetType: "team",
				targetId: team.teamId,
				targetName: team.name,
				metadata: { projects: projectIds.length },
			});
			return { teamId: team.teamId, projectIds };
		}),

	/**
	 * Move a member between "sees every project" and "sees only their teams'".
	 *
	 * Refused for the caller's own membership. Scoping yourself to teams you are
	 * not in is a self-inflicted lockout, and unlike the SSO switch there would
	 * be nobody else obliged to notice.
	 */
	setMemberScope: protectedProcedure
		.input(z.object({ userId: z.string().min(1), projectScope: z.enum(PROJECT_SCOPES) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");

			if (input.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"You cannot change your own project scope — ask another admin, so nobody scopes themselves out of the projects they administer.",
				});
			}

			const membership = await db.query.members.findFirst({
				where: and(eq(members.userId, input.userId), eq(members.organizationId, organizationId)),
			});
			if (!membership) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
			}
			// An owner or admin administers the organization; scoping them to a
			// subset of its projects is a contradiction, and the panel would then
			// hide from them the very projects they are responsible for.
			if (
				input.projectScope === "teams" &&
				(membership.role === "owner" || membership.role === "admin")
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `A ${membership.role} administers the whole organization and cannot be scoped to teams. Lower their role first.`,
				});
			}

			await db
				.update(members)
				.set({ projectScope: input.projectScope })
				.where(eq(members.id, membership.id));
			void auditFromSession(ctx, organizationId, {
				action: "team.setMemberScope",
				targetType: "member",
				targetId: membership.id,
				metadata: { userId: input.userId, projectScope: input.projectScope },
			});
			return { userId: input.userId, projectScope: input.projectScope };
		}),
});
