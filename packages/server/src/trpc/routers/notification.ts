import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { insertNotificationSchema, notifications } from "../../db/schema";
import {
	customConfigSchema,
	discordConfigSchema,
	emailConfigSchema,
	gotifyConfigSchema,
	larkConfigSchema,
	mattermostConfigSchema,
	ntfyConfigSchema,
	pushoverConfigSchema,
	sendTestNotification,
	slackConfigSchema,
	teamsConfigSchema,
	telegramConfigSchema,
} from "../../modules/notifications";
import { assertCapability, assertOrgRole, hasOrgRole, resolveCallerOrganizationId } from "../../modules/projects";
import { protectedProcedure, router } from "../init";

/** Caller organization; falls back to first membership when the session has none active. */
function organizationId(ctx: {
	session: { user: { id: string }; session: { activeOrganizationId?: string | null } };
}) {
	return resolveCallerOrganizationId(ctx.session.user.id, ctx.session.session.activeOrganizationId);
}

async function findNotificationInOrg(notificationId: string, orgId: string) {
	const row = await db.query.notifications.findFirst({
		where: and(
			eq(notifications.notificationId, notificationId),
			eq(notifications.organizationId, orgId),
		),
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found" });
	}
	return row;
}

/** Channel configs hold webhook URLs / bot tokens — strip for viewers. */
const publicNotification = <
	T extends {
		slackConfig: unknown;
		telegramConfig: unknown;
		discordConfig: unknown;
		emailConfig: unknown;
		gotifyConfig: unknown;
		ntfyConfig: unknown;
		pushoverConfig: unknown;
		mattermostConfig: unknown;
		larkConfig: unknown;
		teamsConfig: unknown;
		customConfig: unknown;
	},
>(
	row: T,
	canSeeSecrets: boolean,
): T => {
	if (canSeeSecrets) return row;
	return {
		...row,
		slackConfig: null,
		telegramConfig: null,
		discordConfig: null,
		emailConfig: null,
		gotifyConfig: null,
		ntfyConfig: null,
		pushoverConfig: null,
		mattermostConfig: null,
		larkConfig: null,
		teamsConfig: null,
		customConfig: null,
	};
};

const notificationTypeSchema = z.enum([
	"slack",
	"telegram",
	"discord",
	"email",
	"gotify",
	"ntfy",
	"pushover",
	"mattermost",
	"lark",
	"teams",
	"custom",
]);

const channelConfigsSchema = z.object({
	slackConfig: slackConfigSchema.nullish(),
	telegramConfig: telegramConfigSchema.nullish(),
	discordConfig: discordConfigSchema.nullish(),
	emailConfig: emailConfigSchema.nullish(),
	gotifyConfig: gotifyConfigSchema.nullish(),
	ntfyConfig: ntfyConfigSchema.nullish(),
	pushoverConfig: pushoverConfigSchema.nullish(),
	mattermostConfig: mattermostConfigSchema.nullish(),
	larkConfig: larkConfigSchema.nullish(),
	teamsConfig: teamsConfigSchema.nullish(),
	customConfig: customConfigSchema.nullish(),
});

const eventTogglesSchema = z.object({
	appDeploy: z.boolean().optional(),
	appBuildError: z.boolean().optional(),
	databaseBackup: z.boolean().optional(),
	nixployRestart: z.boolean().optional(),
	dockerCleanup: z.boolean().optional(),
	serverThreshold: z.boolean().optional(),
	serviceAlert: z.boolean().optional(),
	uptimeFlip: z.boolean().optional(),
});

const createNotificationSchema = z
	.object({
		name: z.string().min(1),
		type: notificationTypeSchema,
	})
	.merge(channelConfigsSchema)
	.merge(eventTogglesSchema);

const updateNotificationSchema = insertNotificationSchema
	.partial()
	.omit({ notificationId: true, organizationId: true, createdAt: true })
	.merge(channelConfigsSchema)
	.extend({ notificationId: z.string().min(1) });

/** Test an unsaved channel config (UI "test connection" before saving). */
const testNotificationSchema = z
	.object({
		notificationId: z.string().optional(),
		name: z.string().optional(),
		type: notificationTypeSchema.optional(),
	})
	.merge(channelConfigsSchema)
	.refine((v) => v.notificationId || v.type, {
		message: "Either notificationId or a type + config is required",
	});

export const notificationRouter = router({
	all: protectedProcedure.query(async ({ ctx }) => {
		const orgId = await organizationId(ctx);
		const canSeeSecrets = await hasOrgRole(ctx.session.user.id, orgId, "member");
		const rows = await db.query.notifications.findMany({
			where: eq(notifications.organizationId, orgId),
			orderBy: (n, { desc }) => [desc(n.createdAt)],
		});
		return rows.map((row) => publicNotification(row, canSeeSecrets));
	}),

	one: protectedProcedure
		.input(z.object({ notificationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const orgId = await organizationId(ctx);
			const canSeeSecrets = await hasOrgRole(ctx.session.user.id, orgId, "member");
			return publicNotification(
				await findNotificationInOrg(input.notificationId, orgId),
				canSeeSecrets,
			);
		}),

	create: protectedProcedure.input(createNotificationSchema).mutation(async ({ ctx, input }) => {
		const orgId = await organizationId(ctx);
		await assertCapability(ctx.session.user.id, orgId, "notifications.manage");
		const [row] = await db
			.insert(notifications)
			.values({ ...input, organizationId: orgId })
			.returning();
		return row;
	}),

	update: protectedProcedure.input(updateNotificationSchema).mutation(async ({ ctx, input }) => {
		const orgId = await organizationId(ctx);
		await assertCapability(ctx.session.user.id, orgId, "notifications.manage");
		await findNotificationInOrg(input.notificationId, orgId);
		const { notificationId, ...values } = input;
		const [row] = await db
			.update(notifications)
			.set(values)
			.where(eq(notifications.notificationId, notificationId))
			.returning();
		return row;
	}),

	remove: protectedProcedure
		.input(z.object({ notificationId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const orgId = await organizationId(ctx);
			await assertCapability(ctx.session.user.id, orgId, "notifications.manage");
			await findNotificationInOrg(input.notificationId, orgId);
			await db.delete(notifications).where(eq(notifications.notificationId, input.notificationId));
			return true;
		}),

	test: protectedProcedure.input(testNotificationSchema).mutation(async ({ ctx, input }) => {
		const orgId = await organizationId(ctx);
		await assertCapability(ctx.session.user.id, orgId, "notifications.manage");
		if (input.notificationId) {
			await findNotificationInOrg(input.notificationId, orgId);
			await sendTestNotification({ notificationId: input.notificationId });
		} else {
			await sendTestNotification({
				type: input.type as NonNullable<typeof input.type>,
				name: input.name ?? "test",
				slackConfig: input.slackConfig,
				telegramConfig: input.telegramConfig,
				discordConfig: input.discordConfig,
				emailConfig: input.emailConfig,
				gotifyConfig: input.gotifyConfig,
				ntfyConfig: input.ntfyConfig,
				pushoverConfig: input.pushoverConfig,
				mattermostConfig: input.mattermostConfig,
				larkConfig: input.larkConfig,
				teamsConfig: input.teamsConfig,
				customConfig: input.customConfig,
			});
		}
		return true;
	}),
});
