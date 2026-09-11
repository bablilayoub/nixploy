import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertCapability, resolveCallerOrganizationId } from "../../modules/projects";
import { serviceKindSchema } from "../../modules/services/registry";
import {
	createTag,
	deleteTag,
	listTags,
	setServiceTags,
	tagsForServices,
	updateTag,
} from "../../modules/tags";
import { protectedProcedure, router } from "../init";

export const tagRouter = router({
	all: protectedProcedure.query(async ({ ctx }) => {
		const organizationId = await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		return listTags(organizationId);
	}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(64),
				color: z
					.string()
					.regex(/^#[0-9A-Fa-f]{6}$/)
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "tags.manage");
			const tag = await createTag(organizationId, input);
			await auditFromSession(ctx, organizationId, {
				action: "tag.create",
				targetType: "tag",
				targetId: tag?.tagId,
				targetName: tag?.name,
			});
			return tag;
		}),

	update: protectedProcedure
		.input(
			z.object({
				tagId: z.string().min(1),
				name: z.string().min(1).max(64).optional(),
				color: z
					.string()
					.regex(/^#[0-9A-Fa-f]{6}$/)
					.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "tags.manage");
			const { tagId, ...data } = input;
			return updateTag(tagId, organizationId, data);
		}),

	delete: protectedProcedure
		.input(z.object({ tagId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "tags.manage");
			const result = await deleteTag(input.tagId, organizationId);
			await auditFromSession(ctx, organizationId, {
				action: "tag.delete",
				targetType: "tag",
				targetId: input.tagId,
			});
			return result;
		}),

	setServiceTags: protectedProcedure
		.input(
			z.object({
				type: serviceKindSchema,
				serviceId: z.string().min(1),
				tagIds: z.array(z.string().min(1)),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			await assertCapability(ctx.session.user.id, organizationId, "tags.manage");
			return setServiceTags(organizationId, input.type, input.serviceId, input.tagIds);
		}),

	forServices: protectedProcedure
		.input(
			z.object({
				services: z.array(
					z.object({
						type: serviceKindSchema,
						id: z.string().min(1),
					}),
				),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await resolveCallerOrganizationId(
				ctx.session.user.id,
				ctx.session.session.activeOrganizationId,
			);
			return tagsForServices(organizationId, input.services);
		}),
});
