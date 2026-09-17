import { resolve4, resolve6 } from "node:dns/promises";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { detectPublicIp } from "../../modules/cluster/public-host";
import { dockerCleanup } from "../../modules/deployment";
import { emitDockerCleanupNotification } from "../../modules/notifications";
import { resolveCallerOrganizationId } from "../../modules/projects";
import {
	ACME_DNS_PROVIDERS,
	ensureTraefikSetup,
	getDynamicDir,
	getTraefikDir,
	normalizeDashboardDomain,
	restartTraefik,
	writeDashboardRouterConfig,
} from "../../modules/traefik";
import { invalidatePrivateEgressCache } from "../../utils/public-url";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

/** Platform-wide settings mutate shared infrastructure — instance admin only. */
async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	// Ensure the caller still has an org context (membership) for audit trails.
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
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

const acmeDnsProviderSchema = z.enum(
	ACME_DNS_PROVIDERS.map((provider) => provider.code) as [string, ...string[]],
);

const updateSettingsInput = z.object({
	host: z.string().nullish(),
	letsEncryptEmail: z.email().nullish(),
	certificateType: z.enum(["letsencrypt", "custom", "none"]).optional(),
	/** `null` disables DNS-01 (wildcard certificates stop being issuable). */
	acmeDnsProvider: acmeDnsProviderSchema.nullish(),
	/** `{ CF_DNS_API_TOKEN: "…" }` — stored encrypted, never returned. */
	acmeDnsCredentials: z.record(z.string().min(1).max(64), z.string().max(4096)).nullish(),
	traefikDashboardEnabled: z.boolean().optional(),
	cleanupCronEnabled: z.boolean().optional(),
	cleanupCronExpression: z.string().nullish(),
	cpuAlertPercent: z.number().int().min(1).max(100).nullish(),
	memoryAlertPercent: z.number().int().min(1).max(100).nullish(),
	/**
	 * Instance-wide opt-in for outbound requests to private/LAN addresses
	 * (self-hosted MinIO, Gotify, Gitea, SMTP). Off by default — see
	 * `utils/public-url.ts` and docs/hardening.md.
	 */
	allowPrivateEgress: z.boolean().optional(),
});

export const webServerRouter = router({
	/** The singleton web-server settings row (null until first saved). */
	getSettings: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
		const [row] = await db.select().from(webServerSettings).limit(1);
		if (!row) return null;
		const extras = readExtras(row.metricsConfig);
		const { metricsConfig: _metricsConfig, acmeDnsCredentials, ...publicRow } = row;
		return {
			...publicRow,
			// Credentials are write-only: report which env keys are set, never
			// their values.
			acmeDnsCredentialKeys:
				acmeDnsCredentials && typeof acmeDnsCredentials === "object"
					? Object.keys(acmeDnsCredentials as Record<string, unknown>).sort()
					: [],
			traefikDashboardEnabled: extras.traefikDashboardEnabled ?? false,
			cleanupCronEnabled: extras.cleanupCronEnabled ?? false,
			cleanupCronExpression: extras.cleanupCronExpression ?? null,
			cpuAlertPercent: extras.cpuAlertPercent ?? null,
			memoryAlertPercent: extras.memoryAlertPercent ?? null,
		};
	}),

	/**
	 * DNS-01 providers offered for wildcard certificates, with the environment
	 * variables Traefik needs for each. Nixploy stores the values (encrypted)
	 * but cannot inject them into the proxy container by itself — the operator
	 * runs the `docker service update --env-add` step from
	 * docs/domains-traefik.md.
	 */
	acmeDnsProviders: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
		return ACME_DNS_PROVIDERS.map((provider) => ({
			code: provider.code as string,
			label: provider.label as string,
			envKeys: [...provider.envKeys] as string[],
		}));
	}),

	/**
	 * Upsert the singleton settings row. When the Let's Encrypt email
	 * changes, the Traefik bootstrap re-runs so the static traefik.yml is
	 * rewritten with the new ACME account and the running proxy is
	 * force-updated to load it (`ensureTraefikSetup` restarts only when the
	 * rendered file actually changed).
	 */
	updateSettings: protectedProcedure.input(updateSettingsInput).mutation(async ({ ctx, input }) => {
		const organizationId = await requireInstanceAdmin(ctx.session);
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

		// The dashboard domain is stored normalized ("panel.example.com").
		let host: string | null | undefined;
		if (input.host !== undefined) {
			host = normalizeDashboardDomain(input.host);
			if (input.host?.trim() && !host) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Enter a valid domain, e.g. panel.nixploy.com",
				});
			}
		}

		const values = {
			...(host !== undefined && { host }),
			...(input.letsEncryptEmail !== undefined && {
				letsEncryptEmail: input.letsEncryptEmail,
			}),
			...(input.certificateType !== undefined && {
				certificateType: input.certificateType,
			}),
			...(input.acmeDnsProvider !== undefined && {
				acmeDnsProvider: input.acmeDnsProvider ?? null,
			}),
			...(input.acmeDnsCredentials !== undefined && {
				acmeDnsCredentials: input.acmeDnsCredentials ?? null,
			}),
			...(input.allowPrivateEgress !== undefined && {
				allowPrivateEgress: input.allowPrivateEgress,
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
		if (input.allowPrivateEgress !== undefined) {
			// The guard caches the flag for 30s; drop it so the next outbound
			// check sees the new value immediately.
			invalidatePrivateEgressCache();
		}

		// Rewrite traefik.yml when the ACME account email changed, and the
		// dashboard router when the domain changed. Failures (e.g. no docker
		// on a UI-only dev machine) must not lose the save.
		let traefikConfigRewritten = false;
		const emailChanged =
			input.letsEncryptEmail !== undefined &&
			input.letsEncryptEmail !== (existing?.letsEncryptEmail ?? null);
		const hostChanged = host !== undefined && host !== (existing?.host ?? null);
		// A new DNS-01 provider adds the `letsencrypt-dns` resolver to the
		// STATIC config, which Traefik only reads at start — `ensureTraefikSetup`
		// notices the changed file and restarts the proxy.
		const dnsProviderChanged =
			input.acmeDnsProvider !== undefined &&
			(input.acmeDnsProvider ?? null) !== (existing?.acmeDnsProvider ?? null);
		// Credentials do not touch traefik.yml — they are environment variables
		// on the proxy service — but `ensureTraefikSetup` is what pushes them,
		// so a credentials-only save has to run it too. Without this, rotating a
		// DNS token saved the row and left the proxy on the old one.
		const dnsCredentialsChanged = input.acmeDnsCredentials !== undefined;
		if (emailChanged || hostChanged || dnsProviderChanged || dnsCredentialsChanged) {
			try {
				await ensureTraefikSetup();
				traefikConfigRewritten = true;
			} catch {
				if (hostChanged) {
					// Still try to hot-write the router file alone.
					try {
						await writeDashboardRouterConfig(host ?? null);
						traefikConfigRewritten = true;
					} catch {
						traefikConfigRewritten = false;
					}
				}
			}
		}

		void auditFromSession(ctx, organizationId, {
			action: "webServer.updateSettings",
			targetType: "webServerSettings",
			targetId: existing?.webServerSettingsId ?? null,
			targetName: host ?? existing?.host ?? null,
			metadata: {
				certificateType: input.certificateType,
				acmeDnsProviderChanged: dnsProviderChanged,
				acmeDnsCredentialsChanged: dnsCredentialsChanged,
				allowPrivateEgress: input.allowPrivateEgress,
				hostChanged,
				traefikConfigRewritten,
			},
		});
		return { success: true, traefikConfigRewritten, host: host ?? existing?.host ?? null };
	}),

	/**
	 * DNS preflight for the dashboard domain: does it resolve, and does it
	 * point at this server's public IP? Advisory only — saving is allowed
	 * either way (DNS may still be propagating).
	 */
	checkDashboardDomain: protectedProcedure
		.input(z.object({ domain: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireInstanceAdmin(ctx.session);
			const domain = normalizeDashboardDomain(input.domain);
			if (!domain) {
				return {
					domain: input.domain,
					valid: false as const,
					resolvedIps: [] as string[],
					serverIp: null,
					matches: false,
				};
			}
			const [v4, v6, serverIp] = await Promise.all([
				resolve4(domain).catch(() => [] as string[]),
				resolve6(domain).catch(() => [] as string[]),
				detectPublicIp({ fresh: true }),
			]);
			const resolvedIps = [...v4, ...v6];
			return {
				domain,
				valid: true as const,
				resolvedIps,
				serverIp,
				matches: serverIp !== null && v4.includes(serverIp),
			};
		}),

	/** Static traefik.yml contents plus the dynamic file-provider config names. */
	getTraefikConfig: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
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
		const organizationId = await requireInstanceAdmin(ctx.session);
		await restartTraefik();
		void auditFromSession(ctx, organizationId, {
			action: "webServer.restartTraefik",
			targetType: "webServerSettings",
		});
		return { success: true };
	}),

	/** Prune unused images and build cache on the Nixploy host, on demand. */
	dockerCleanupNow: protectedProcedure.mutation(async ({ ctx }) => {
		const organizationId = await requireInstanceAdmin(ctx.session);
		await dockerCleanup();
		void emitDockerCleanupNotification(organizationId, {
			scope: "build-cache",
			serverId: null,
			actor: ctx.session.user.email,
		});
		void auditFromSession(ctx, organizationId, {
			action: "webServer.dockerCleanup",
			targetType: "webServerSettings",
			metadata: { scope: "build-cache" },
		});
		return { success: true };
	}),
});
