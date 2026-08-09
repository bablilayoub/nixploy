import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { invitations, members, organizations, projects } from "../../db/schema";
import { auth } from "../../lib/auth";
import { auditFromSession } from "../../modules/audit";
import {
	assertCapability,
	capabilitySchemaValues,
	effectiveCapabilities,
	getOrganizationServiceStatusCounts,
	ORG_ROLE_RANK,
	type OrgCapability,
	orgRoleRank,
	parseCapabilityOverrides,
	parseOrgMetadata,
	publicCapabilityCatalog,
	resolveCallerOrganizationId,
	roleDefaultCapabilities,
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
			requireTwoFactor: org.requireTwoFactor,
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

	/** Update quotas, branding, logo, or the 2FA requirement (admin/owner only). */
	updateSettings: protectedProcedure
		.input(
			z.object({
				quotas: quotaInputSchema.optional(),
				branding: brandingInputSchema.optional(),
				logo: z.string().nullable().optional(),
				requireTwoFactor: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "settings.manage");

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
					...(input.requireTwoFactor !== undefined
						? { requireTwoFactor: input.requireTwoFactor }
						: {}),
				})
				.where(eq(organizations.id, organizationId))
				.returning();

			await auditFromSession(ctx, organizationId, {
				action: "organization.update",
				targetType: "organization",
				targetId: organizationId,
				targetName: org.name,
				metadata:
					input.requireTwoFactor !== undefined
						? { requireTwoFactor: input.requireTwoFactor }
						: undefined,
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
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");

			const callerMembership = await db.query.members.findFirst({
				where: and(
					eq(members.organizationId, organizationId),
					eq(members.userId, ctx.session.user.id),
				),
			});
			if (!callerMembership) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
			}
			const callerRank = orgRoleRank(callerMembership.role);
			const inviteRank = ORG_ROLE_RANK[input.role];
			if (inviteRank >= callerRank) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot invite a member at or above your own role",
				});
			}

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

	/** Catalog of capabilities and role defaults (for the members UI). */
	capabilityCatalog: protectedProcedure.query(async ({ ctx }) => {
		await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		return publicCapabilityCatalog();
	}),

	/** Effective capabilities for the signed-in member (UI gating). */
	myCapabilities: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const membership = await db.query.members.findFirst({
			where: and(
				eq(members.organizationId, organizationId),
				eq(members.userId, ctx.session.user.id),
			),
		});
		if (!membership) {
			throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
		}
		const overrides = parseCapabilityOverrides(membership.capabilityOverrides);
		return {
			organizationId,
			role: membership.role,
			capabilities: [...effectiveCapabilities(membership.role, overrides)].sort(),
			defaults: [...roleDefaultCapabilities(membership.role)],
			overrides,
		};
	}),

	/** Effective capabilities + overrides for one member. */
	memberCapabilities: protectedProcedure
		.input(z.object({ memberId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");
			const membership = await db.query.members.findFirst({
				where: and(eq(members.id, input.memberId), eq(members.organizationId, organizationId)),
			});
			if (!membership) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
			}
			const overrides = parseCapabilityOverrides(membership.capabilityOverrides);
			return {
				memberId: membership.id,
				userId: membership.userId,
				role: membership.role,
				overrides,
				effective: [...effectiveCapabilities(membership.role, overrides)].sort(),
				defaults: [...roleDefaultCapabilities(membership.role)],
			};
		}),

	/** Set grant/revoke overlays for a member (admin+ with members.manage). */
	setMemberCapabilities: protectedProcedure
		.input(
			z.object({
				memberId: z.string().min(1),
				grant: z.array(z.enum(capabilitySchemaValues)).default([]),
				revoke: z.array(z.enum(capabilitySchemaValues)).default([]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "members.manage");

			const membership = await db.query.members.findFirst({
				where: and(eq(members.id, input.memberId), eq(members.organizationId, organizationId)),
			});
			if (!membership) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
			}
			if (membership.userId === ctx.session.user.id) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot modify your own capabilities",
				});
			}

			const callerMembership = await db.query.members.findFirst({
				where: and(
					eq(members.organizationId, organizationId),
					eq(members.userId, ctx.session.user.id),
				),
			});
			if (!callerMembership) {
				throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
			}
			if (orgRoleRank(membership.role) >= orgRoleRank(callerMembership.role)) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Cannot modify a member at or above your own role",
				});
			}

			const callerOverrides = parseCapabilityOverrides(callerMembership.capabilityOverrides);
			const callerCaps = effectiveCapabilities(callerMembership.role, callerOverrides);
			for (const cap of input.grant) {
				if (!callerCaps.has(cap as OrgCapability)) {
					throw new TRPCError({
						code: "FORBIDDEN",
						message: `Cannot grant capability you do not have: ${cap}`,
					});
				}
			}

			const overrides = {
				grant: input.grant as OrgCapability[],
				revoke: input.revoke as OrgCapability[],
			};
			await db
				.update(members)
				.set({ capabilityOverrides: overrides })
				.where(eq(members.id, membership.id));

			await auditFromSession(ctx, organizationId, {
				action: "member.capabilities",
				targetType: "member",
				targetId: membership.id,
				metadata: overrides,
			});

			return {
				memberId: membership.id,
				overrides,
				effective: [...effectiveCapabilities(membership.role, overrides)].sort(),
			};
		}),
});
