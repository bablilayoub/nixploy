import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin, isInstanceAdminRole } from "../../modules/auth/instance-admin";
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

async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/** Only official GHCR image refs — blocks rolling an arbitrary attacker image. */
function assertAllowedUpdateImage(image: string): void {
	const trimmed = image.trim();
	const allowed =
		trimmed === DEFAULT_UPDATE_IMAGE ||
		trimmed.startsWith("ghcr.io/bablilayoub/nixploy:") ||
		trimmed.startsWith("ghcr.io/bablilayoub/nixploy@");
	if (!allowed) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Update image must be under ghcr.io/bablilayoub/nixploy (got ${trimmed})`,
		});
	}
}

const settingsInput = z.object({
	autoCheckEnabled: z.boolean().optional(),
	autoUpdateEnabled: z.boolean().optional(),
	checkCron: z.string().min(1).max(64).optional(),
	image: z.string().min(1).max(256).optional(),
});

export const updatesRouter = router({
	/**
	 * Lightweight banner for every authenticated member: current version and
	 * whether an update was detected. Check/apply stay admin-only via getStatus.
	 */
	banner: protectedProcedure.query(async ({ ctx }) => {
		await resolveCallerOrganizationId(
			ctx.session.user.id,
			ctx.session.session.activeOrganizationId,
		);
		const settings = await getUpdateSettings();
		return {
			appVersion: getAppVersion(),
			updateAvailable: settings.updateAvailable,
			canManageUpdate: isInstanceAdminRole(ctx.session.user.role),
		};
	}),

	/** Current version, digests and auto-update preferences. */
	getStatus: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
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
		await requireInstanceAdmin(ctx.session);
		return checkForUpdates({ persist: true });
	}),

	/** Pull + roll the nixploy Swarm service. The process will restart shortly after. */
	runUpdate: protectedProcedure.mutation(async ({ ctx }) => {
		const organizationId = await requireInstanceAdmin(ctx.session);
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
		await requireInstanceAdmin(ctx.session);
		if (input.image !== undefined) {
			assertAllowedUpdateImage(input.image);
		}
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
