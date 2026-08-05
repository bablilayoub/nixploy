import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { members } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { resolveCallerOrganizationId } from "../../modules/projects";
import {
	applyUpdate,
	checkForUpdates,
	DEFAULT_CHECK_CRON,
	DEFAULT_UPDATE_IMAGE,
	getAppVersion,
	getUpdateSettings,
	patchUpdateSettings,
	rescheduleUpdateChecker,
	resolveStuckUpdate,
} from "../../modules/updates";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function requireOwnerOrAdmin(session: Session): Promise<string> {
	const organizationId = await resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	);
	const membership = await db.query.members.findFirst({
		where: and(eq(members.organizationId, organizationId), eq(members.userId, session.user.id)),
	});
	const roles = (membership?.role ?? "").split(",").map((role) => role.trim());
	if (!roles.includes("owner") && !roles.includes("admin")) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Platform updates require an owner or admin role",
		});
	}
	return organizationId;
}

const settingsInput = z.object({
	autoCheckEnabled: z.boolean().optional(),
	autoUpdateEnabled: z.boolean().optional(),
	checkCron: z.string().min(1).max(64).optional(),
	image: z.string().min(1).max(256).optional(),
});

export const updatesRouter = router({
	/** Current version, digests and auto-update preferences. */
	getStatus: protectedProcedure.query(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
		// Un-stick rolls that never converged so the UI doesn't spin forever.
		await resolveStuckUpdate();
		const settings = await getUpdateSettings();
		return {
			appVersion: getAppVersion(),
			...settings,
			defaultImage: DEFAULT_UPDATE_IMAGE,
			defaultCheckCron: DEFAULT_CHECK_CRON,
		};
	}),

	/** Hit the registry now and compare digests. */
	check: protectedProcedure.mutation(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
		return checkForUpdates({ persist: true });
	}),

	/** Pull + roll the nixploy Swarm service. The process will restart shortly after. */
	runUpdate: protectedProcedure.mutation(async ({ ctx }) => {
		const organizationId = await requireOwnerOrAdmin(ctx.session);
		const settings = await getUpdateSettings();
		const result = await applyUpdate();
		void auditFromSession(ctx, organizationId, {
			action: "platform.update",
			targetType: "web_server",
			targetId: "nixploy",
			targetName: settings.image,
			metadata: { started: result.started, image: result.image },
		});
		return result;
	}),

	/** Toggle auto-check / auto-update and optionally the cron / image. */
	updateSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
		await requireOwnerOrAdmin(ctx.session);
		const next = await patchUpdateSettings({
			...(input.autoCheckEnabled !== undefined && {
				autoCheckEnabled: input.autoCheckEnabled,
			}),
			...(input.autoUpdateEnabled !== undefined && {
				autoUpdateEnabled: input.autoUpdateEnabled,
			}),
			...(input.checkCron !== undefined && { checkCron: input.checkCron.trim() }),
			...(input.image !== undefined && { image: input.image.trim() }),
		});
		await rescheduleUpdateChecker();
		return next;
	}),
});
