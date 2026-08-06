import { TRPCError } from "@trpc/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { invitations, organizations, projects } from "../../db/schema";
import { auth } from "../../lib/auth";
import { auditFromSession } from "../../modules/audit";
import {
	assertOrgRole,
	getOrganizationServiceStatusCounts,
	parseOrgMetadata,
	resolveCallerOrganizationId,
	serializeOrgMetadata,
} from "../../modules/projects";
import { protectedProcedure, router } from "../init";

const invitableRoleSchema = z.enum(["viewer", "member", "deployer", "admin"]);

const quotaInputSchema = z.object({
	maxProjects: z.number().int().min(0).nullable().optional(),
	maxServices: z.number().int().min(0).nullable().optional(),
	maxCpuShares: z.number().int().min(0).nullable().optional(),
	maxMemoryMb: z.number().int().min(0).nullable().optional(),
});

const brandingInputSchema = z.object({
	displayName: z.string().min(1).max(255).nullable().optional(),
	accentColor: z
		.string()
		.regex(/^#[0-9A-Fa-f]{6}$/)
		.nullable()
		.optional(),
});

export const organizationRouter = router({
	/** Quotas, branding and usage for the active organization. */
	settings: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const org = await db.query.organizations.findFirst({
			where: eq(organizations.id, organizationId),
		});
		if (!org) {
			throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
		}
		const metadata = parseOrgMetadata(org.metadata);
		const [projectRows, serviceCounts] = await Promise.all([
			db
				.select({ value: count() })
				.from(projects)
				.where(eq(projects.organizationId, organizationId)),
			getOrganizationServiceStatusCounts(organizationId),
		]);
		return {
			id: org.id,
			name: org.name,
			slug: org.slug,
			logo: org.logo,
			quotas: {
				maxProjects: metadata.quotas?.maxProjects ?? null,
				maxServices: metadata.quotas?.maxServices ?? null,
				maxCpuShares: metadata.quotas?.maxCpuShares ?? null,
				maxMemoryMb: metadata.quotas?.maxMemoryMb ?? null,
			},
			branding: {
				displayName: metadata.branding?.displayName ?? null,
				accentColor: metadata.branding?.accentColor ?? null,
			},
			usage: {
				projects: projectRows[0]?.value ?? 0,
				services: serviceCounts.total,
			},
		};
	}),

	/** Update quotas, branding, or logo (admin/owner only). */
	updateSettings: protectedProcedure
		.input(
			z.object({
				quotas: quotaInputSchema.optional(),
				branding: brandingInputSchema.optional(),
				logo: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");

			const org = await db.query.organizations.findFirst({
				where: eq(organizations.id, organizationId),
			});
			if (!org) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
			}

			const metadata = parseOrgMetadata(org.metadata);
			if (input.quotas) {
				metadata.quotas = { ...metadata.quotas, ...input.quotas };
			}
			if (input.branding) {
				metadata.branding = { ...metadata.branding, ...input.branding };
			}

			const [updated] = await db
				.update(organizations)
				.set({
					metadata: serializeOrgMetadata(metadata),
					...(input.logo !== undefined ? { logo: input.logo } : {}),
				})
				.where(eq(organizations.id, organizationId))
				.returning();

			await auditFromSession(ctx, organizationId, {
				action: "organization.update",
				targetType: "organization",
				targetId: organizationId,
				targetName: org.name,
			});

			return updated;
		}),

	/**
	 * Invite a member with a custom expiry. Wraps better-auth createInvitation
	 * then patches expiresAt (the auth API does not accept expiry in the body).
	 */
	inviteMember: protectedProcedure
		.input(
			z.object({
				email: z.string().email(),
				role: invitableRoleSchema,
				expiryDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(7),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertOrgRole(ctx.session.user.id, organizationId, "admin");

			const invitation = await auth.api.createInvitation({
				body: {
					email: input.email,
					role: input.role,
					organizationId,
				},
				headers: ctx.headers,
			});

			if (!invitation?.id) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create invitation",
				});
			}

			const expiresAt = new Date(Date.now() + input.expiryDays * 24 * 60 * 60 * 1000);
			await db.update(invitations).set({ expiresAt }).where(eq(invitations.id, invitation.id));

			return { ...invitation, expiresAt };
		}),
});
