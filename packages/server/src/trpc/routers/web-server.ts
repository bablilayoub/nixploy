import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { members, webServerSettings } from "../../db/schema";
import { dockerCleanup } from "../../modules/deployment";
import { resolveCallerOrganizationId } from "../../modules/projects";
import {
	ensureTraefikSetup,
	getDynamicDir,
	getTraefikDir,
	TRAEFIK_SERVICE_NAME,
} from "../../modules/traefik";
import { execAsync } from "../../utils/exec";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

/** Platform-wide settings mutate shared infrastructure — owner/admin only. */
async function requireOwnerOrAdmin(session: Session): Promise<void> {
	const organizationId = await resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	);
	const membership = await db.query.members.findFirst({
		where: and(eq(members.organizationId, organizationId), eq(members.userId, session.user.id)),
	});
	// better-auth stores comma-separated roles (e.g. "admin,member").
	const roles = (membership?.role ?? "").split(",").map((role) => role.trim());
	if (!roles.includes("owner") && !roles.includes("admin")) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Web server settings require an owner or admin role",
		});
	}
}

/**
 * The web_server_settings table only has columns for host, ACME email and
 * certificate type; the remaining toggles live inside the metricsConfig
 * JSONB under this key so no migration is needed.
 */
const EXTRAS_KEY = "webServer";

interface WebServerExtras {
	traefikDashboardEnabled?: boolean;
	cleanupCronEnabled?: boolean;
	cleanupCronExpression?: string | null;
	/** Service alert thresholds (rolling average over ~2.5 min). 0/null = off. */
	cpuAlertPercent?: number | null;
	memoryAlertPercent?: number | null;
}

function readExtras(metricsConfig: unknown): WebServerExtras {
	if (typeof metricsConfig === "object" && metricsConfig !== null) {
		const extras = (metricsConfig as Record<string, unknown>)[EXTRAS_KEY];
		if (typeof extras === "object" && extras !== null) {
			return extras as WebServerExtras;
		}
	}
	return {};
}

function baseMetricsConfig(metricsConfig: unknown): Record<string, unknown> {
	return typeof metricsConfig === "object" && metricsConfig !== null
		? (metricsConfig as Record<string, unknown>)
		: {};
}

const updateSettingsInput = z.object({
	host: z.string().nullish(),
	letsEncryptEmail: z.email().nullish(),
	certificateType: z.enum(["letsencrypt", "custom", "none"]).optional(),
	traefikDashboardEnabled: z.boolean().optional(),
	cleanupCronEnabled: z.boolean().optional(),
	cleanupCronExpression: z.string().nullish(),
	cpuAlertPercent: z.number().int().min(1).max(100).nullish(),
	memoryAlertPercent: z.number().int().min(1).max(100).nullish(),
});

export const webServerRouter = router({
	/** The singleton web-server settings row (null until first saved). */
	getSettings: protectedProcedure.query(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
		const [row] = await db.select().from(webServerSettings).limit(1);
		if (!row) return null;
		const extras = readExtras(row.metricsConfig);
		return {
			...row,
			traefikDashboardEnabled: extras.traefikDashboardEnabled ?? false,
			cleanupCronEnabled: extras.cleanupCronEnabled ?? false,
			cleanupCronExpression: extras.cleanupCronExpression ?? null,
			cpuAlertPercent: extras.cpuAlertPercent ?? null,
			memoryAlertPercent: extras.memoryAlertPercent ?? null,
		};
	}),

	/**
	 * Upsert the singleton settings row. When the Let's Encrypt email
	 * changes, the Traefik bootstrap re-runs so the static traefik.yml is
	 * rewritten with the new ACME account (the running proxy picks it up on
	 * the next `restartTraefik`).
	 */
	updateSettings: protectedProcedure.input(updateSettingsInput).mutation(async ({ ctx, input }) => {
		await requireOwnerOrAdmin(ctx.session);
		const [existing] = await db.select().from(webServerSettings).limit(1);

		const extras: WebServerExtras = {
			...readExtras(existing?.metricsConfig),
			...(input.traefikDashboardEnabled !== undefined && {
				traefikDashboardEnabled: input.traefikDashboardEnabled,
			}),
			...(input.cleanupCronEnabled !== undefined && {
				cleanupCronEnabled: input.cleanupCronEnabled,
			}),
			...(input.cleanupCronExpression !== undefined && {
				cleanupCronExpression: input.cleanupCronExpression,
			}),
			...(input.cpuAlertPercent !== undefined && {
				cpuAlertPercent: input.cpuAlertPercent,
			}),
			...(input.memoryAlertPercent !== undefined && {
				memoryAlertPercent: input.memoryAlertPercent,
			}),
		};
		const metricsConfig = {
			...baseMetricsConfig(existing?.metricsConfig),
			[EXTRAS_KEY]: extras,
		};

		const values = {
			...(input.host !== undefined && { host: input.host }),
			...(input.letsEncryptEmail !== undefined && {
				letsEncryptEmail: input.letsEncryptEmail,
			}),
			...(input.certificateType !== undefined && {
				certificateType: input.certificateType,
			}),
			metricsConfig,
		};

		if (existing) {
			await db
				.update(webServerSettings)
				.set(values)
				.where(eq(webServerSettings.webServerSettingsId, existing.webServerSettingsId));
		} else {
			await db.insert(webServerSettings).values(values);
		}

		// Rewrite traefik.yml when the ACME account email changed. Failures
		// (e.g. no docker on a UI-only dev machine) must not lose the save.
		let traefikConfigRewritten = false;
		if (
			input.letsEncryptEmail !== undefined &&
			input.letsEncryptEmail !== (existing?.letsEncryptEmail ?? null)
		) {
			try {
				await ensureTraefikSetup();
				traefikConfigRewritten = true;
			} catch {
				traefikConfigRewritten = false;
			}
		}

		return { success: true, traefikConfigRewritten };
	}),

	/** Static traefik.yml contents plus the dynamic file-provider config names. */
	getTraefikConfig: protectedProcedure.query(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
		const staticConfig = await readFile(join(getTraefikDir(), "traefik.yml"), "utf8").catch(
			() => null,
		);
		const dynamicConfigs = await readdir(getDynamicDir())
			.then((entries) =>
				entries.filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml")).sort(),
			)
			.catch(() => [] as string[]);
		return { staticConfig, dynamicConfigs };
	}),

	/** Force-restart the global Traefik swarm service (picks up static config changes). */
	restartTraefik: protectedProcedure.mutation(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
		const output = await execAsync(`docker service update --force ${TRAEFIK_SERVICE_NAME}`);
		return { success: true, output };
	}),

	/** Prune unused images and build cache on the Nixploy host, on demand. */
	dockerCleanupNow: protectedProcedure.mutation(async ({ ctx }) => {
		await requireOwnerOrAdmin(ctx.session);
		await dockerCleanup();
		return { success: true };
	}),
});
