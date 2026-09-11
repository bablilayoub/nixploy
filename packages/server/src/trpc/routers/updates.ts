import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin, isInstanceAdminRole } from "../../modules/auth/instance-admin";
import { resolveCallerOrganizationId } from "../../modules/projects";
import {
	applyUpdate,
	assertValidImageRef,
	checkForUpdates,
	DEFAULT_CHECK_CRON,
	DEFAULT_UPDATE_IMAGE,
	getAppVersion,
	getUpdateSettings,
	isValidUpdateCron,
	parseVersion,
	patchUpdateSettings,
	rescheduleUpdateChecker,
	resolveStuckUpdate,
	VERSION_PATTERN,
} from "../../modules/updates";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/**
 * Only well-formed official GHCR image refs — blocks rolling an arbitrary
 * attacker image and anything that is not a plain `repo:tag` / `repo@digest`
 * (the ref reaches a shell in modules/updates/apply.ts). Returns the
 * canonical form that is persisted.
 */
function assertAllowedUpdateImage(image: string): string {
	const canonical = assertValidImageRef(image).canonical;
	const allowed =
		canonical === DEFAULT_UPDATE_IMAGE ||
		canonical.startsWith("ghcr.io/bablilayoub/nixploy:") ||
		canonical.startsWith("ghcr.io/bablilayoub/nixploy@");
	if (!allowed) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Update image must be under ghcr.io/bablilayoub/nixploy (got ${image.trim()})`,
		});
	}
	return canonical;
}

/** `1.2.3` / `v1.2.3`; `null` clears the pin. */
const versionSchema = z
	.string()
	.trim()
	.regex(VERSION_PATTERN, "Expected a release like 1.2.3 or v1.2.3");

const settingsInput = z.object({
	autoCheckEnabled: z.boolean().optional(),
	autoUpdateEnabled: z.boolean().optional(),
	checkCron: z.string().min(1).max(64).optional(),
	image: z.string().min(1).max(256).optional(),
	/** Ceiling for automatic updates; `null` removes it. */
	pinnedVersion: versionSchema.nullish(),
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

	/**
	 * Pull + dump the database + roll the nixploy Swarm service. The process
	 * restarts shortly after. Refused while deployments are running unless
	 * `force` is set (the UI asks for confirmation first).
	 */
	runUpdate: protectedProcedure
		.input(
			z
				.object({
					force: z.boolean().optional(),
					/**
					 * Roll to this release instead of the tracked tag. Only the TAG
					 * of the configured image is replaced — the registry and
					 * repository stay the ones this instance already trusts.
					 */
					version: versionSchema.optional(),
					/** Required to roll to an OLDER release (migrations do not roll back). */
					allowDowngrade: z.boolean().optional(),
				})
				.optional(),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			const settings = await getUpdateSettings();
			const force = input?.force ?? false;
			const result = await applyUpdate({
				force,
				version: input?.version,
				allowDowngrade: input?.allowDowngrade,
			});
			void auditFromSession(ctx, organizationId, {
				action: "platform.update",
				targetType: "web_server",
				targetId: "nixploy",
				targetName: settings.image,
				metadata: {
					started: result.started,
					image: result.image,
					force,
					...(input?.version && { version: input.version }),
					...(result.isDowngrade && { downgrade: true }),
					...(result.blockedByDeployments && {
						blockedByDeployments: true,
						activeDeployments: result.activeDeployments,
					}),
					...(result.backupPath && { backupPath: result.backupPath }),
				},
			});
			return result;
		}),

	/** Toggle auto-check / auto-update and optionally the cron / image. */
	updateSettings: protectedProcedure.input(settingsInput).mutation(async ({ ctx, input }) => {
		const organizationId = await requireInstanceAdmin(ctx.session);
		const image = input.image !== undefined ? assertAllowedUpdateImage(input.image) : undefined;
		// `pinnedVersion: null` clears the pin; `undefined` leaves it alone.
		const pinnedVersion =
			input.pinnedVersion === undefined
				? undefined
				: input.pinnedVersion === null
					? null
					: (() => {
							const parsed = parseVersion(input.pinnedVersion);
							if (!parsed) {
								throw new TRPCError({
									code: "BAD_REQUEST",
									message: `Invalid version "${input.pinnedVersion}"`,
								});
							}
							return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
						})();
		const checkCron = input.checkCron?.trim();
		if (checkCron !== undefined && !isValidUpdateCron(checkCron)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Invalid cron expression "${checkCron}" (expected 5 or 6 fields, e.g. "${DEFAULT_CHECK_CRON}")`,
			});
		}
		const next = await patchUpdateSettings({
			...(input.autoCheckEnabled !== undefined && {
				autoCheckEnabled: input.autoCheckEnabled,
			}),
			...(input.autoUpdateEnabled !== undefined && {
				autoUpdateEnabled: input.autoUpdateEnabled,
			}),
			...(checkCron !== undefined && { checkCron }),
			...(image !== undefined && { image }),
			...(pinnedVersion !== undefined && { pinnedVersion }),
		});
		await rescheduleUpdateChecker();
		void auditFromSession(ctx, organizationId, {
			action: "platform.update.settings",
			targetType: "web_server",
			targetId: "nixploy",
			metadata: {
				autoCheckEnabled: next.autoCheckEnabled,
				autoUpdateEnabled: next.autoUpdateEnabled,
				checkCron: next.checkCron,
				image: next.image,
				pinnedVersion: next.pinnedVersion,
			},
		});
		return next;
	}),
});
