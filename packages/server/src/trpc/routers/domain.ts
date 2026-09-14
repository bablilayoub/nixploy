import { randomBytes } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
	applications,
	certificates,
	compose,
	domainMiddlewares,
	domains,
	environments,
	projects,
	traefikEntrypoints,
	webServerSettings,
} from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	getServiceContext,
	syncApplicationTraefik,
} from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { detectPublicIp } from "../../modules/cluster/public-host";
import { resyncComposeDomains } from "../../modules/compose/service";
import { isUniqueViolation } from "../../modules/errors";
import { syncPreviewTraefik } from "../../modules/preview/traefik";
import { assertCapability } from "../../modules/projects";
import {
	domainMiddlewareKindSchema,
	isWildcardHost,
	parseForwardAuthAddress,
	parseMiddlewareConfig,
} from "../../modules/traefik";
import { assertSafeOutboundUrl } from "../../utils/public-url";
import { takeRateLimitToken } from "../../utils/rate-limit";
import {
	assertComposeServiceName,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";
import { protectedProcedure, router } from "../init";

const domainIdInput = z.object({ domainId: z.string().min(1) });

const certificateTypeSchema = z.enum(["letsencrypt", "none", "custom"]);

const domainProtocolSchema = z.enum(["http", "tcp", "udp"]);
const domainTlsModeSchema = z.enum(["none", "terminate", "passthrough"]);

/**
 * Layer-4 rows (`tcp`/`udp`) need an entrypoint that actually exists in
 * Traefik's static config with the matching protocol — otherwise the router
 * is written and silently never served. UDP has no TLS at all, so a UDP row
 * is pinned to `tlsMode: "none"`; a TCP row without TLS cannot read SNI and
 * therefore claims the whole entrypoint (`HostSNI(\`*\`)`), which is fine —
 * the entrypoint's port is what selects the service.
 *
 * Returns the normalized `{ protocol, entrypoint, tlsMode }` triple to store.
 */
const resolveRouteProtocol = async (input: {
	protocol: z.infer<typeof domainProtocolSchema>;
	entrypoint?: string | null;
	tlsMode?: z.infer<typeof domainTlsModeSchema> | null;
	host: string;
	https?: boolean;
	path?: string | null;
}): Promise<{
	protocol: "http" | "tcp" | "udp";
	entrypoint: string | null;
	tlsMode: "none" | "terminate" | "passthrough";
}> => {
	if (input.protocol === "http") {
		return { protocol: "http", entrypoint: null, tlsMode: "none" };
	}
	const name = input.entrypoint?.trim().toLowerCase() ?? "";
	if (!name) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A TCP or UDP domain needs a Traefik entrypoint",
		});
	}
	const entrypoint = await db.query.traefikEntrypoints.findFirst({
		where: eq(traefikEntrypoints.name, name),
	});
	if (!entrypoint) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `No Traefik entrypoint named “${name}”. Create it under Settings → Server first.`,
		});
	}
	if (entrypoint.protocol !== input.protocol) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Entrypoint “${name}” is ${entrypoint.protocol}, not ${input.protocol}`,
		});
	}
	if (input.protocol === "udp") {
		if (input.tlsMode && input.tlsMode !== "none") {
			throw new TRPCError({ code: "BAD_REQUEST", message: "UDP routing has no TLS" });
		}
		return { protocol: "udp", entrypoint: name, tlsMode: "none" };
	}
	const tlsMode = input.tlsMode ?? "none";
	if (tlsMode === "none" && isWildcardHost(input.host)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A wildcard host needs TLS: a plain TCP router cannot match a hostname",
		});
	}
	return { protocol: "tcp", entrypoint: name, tlsMode };
};

/** HTTP-only options are refused on a layer-4 row instead of being ignored. */
const assertNoHttpOnlyFields = (
	protocol: "http" | "tcp" | "udp",
	fields: { https?: boolean; path?: string | null; internalPath?: string | null },
): void => {
	if (protocol === "http") return;
	if (fields.https) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "“Redirect to HTTPS” only applies to HTTP domains; use the TLS mode instead",
		});
	}
	if ((fields.path && fields.path !== "/") || fields.internalPath) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "TCP and UDP routing has no paths — only the host (SNI) and the entrypoint",
		});
	}
};

/**
 * Let's Encrypt issuance budget per organization. The instance shares one ACME
 * account, so a tenant attaching hosts that do not resolve burns the whole
 * box's rate limit (50 certs/week, 5 failures/hour — security.md §2.10).
 */
const LETSENCRYPT_DOMAINS_PER_HOUR = 20;

const assertLetsEncryptBudget = (organizationId: string): void => {
	if (
		!takeRateLimitToken(`letsencrypt-domain:${organizationId}`, {
			windowMs: 3_600_000,
			max: LETSENCRYPT_DOMAINS_PER_HOUR,
		})
	) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: `At most ${LETSENCRYPT_DOMAINS_PER_HOUR} Let's Encrypt domains can be added per hour. Try again later or use certificate type “None”.`,
		});
	}
};

/**
 * Validate a host that may carry exactly one leading `*.` label. Wildcards go
 * through the same checks as a normal host on the part after `*.`.
 */
const assertHostAllowingWildcard = (host: string): string => {
	const trimmed = host.trim().toLowerCase();
	if (!isWildcardHost(trimmed)) return assertTraefikHost(trimmed);
	const base = trimmed.slice(2);
	if (base.includes("*")) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A wildcard host has exactly one leading “*.” label",
		});
	}
	const normalized = assertTraefikHost(base);
	if (normalized.split(".").filter(Boolean).length < 2) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A wildcard host needs a parent domain, e.g. *.apps.example.com",
		});
	}
	return `*.${normalized}`;
};

/**
 * Nixploy has no proof that an organization owns the parent zone of a
 * wildcard, and `*.example.com` swallows every unclaimed subdomain of it on
 * this instance. Until zone ownership is verifiable, wildcard rows are
 * instance-admin only (documented in docs/domains-traefik.md).
 */
const assertWildcardAllowed = async (
	session: Parameters<typeof assertInstanceAdmin>[0],
	host: string,
	certificateType: z.infer<typeof certificateTypeSchema>,
): Promise<void> => {
	if (!isWildcardHost(host)) return;
	try {
		await assertInstanceAdmin(session);
	} catch {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Wildcard domains can only be added by the instance administrator",
		});
	}
	if (certificateType !== "letsencrypt") return;
	const [settings] = await db.select().from(webServerSettings).limit(1);
	if (!settings?.acmeDnsProvider) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"A wildcard certificate needs the DNS-01 challenge. Configure a DNS provider in Settings → Platform first.",
		});
	}
};

/** `*.traefik.me` resolves to 127.0.0.1 — Let's Encrypt HTTP-01 can never succeed. */
const isLocalWildcardHost = (host: string): boolean =>
	host.trim().toLowerCase().endsWith(".traefik.me") || host.trim().toLowerCase() === "traefik.me";

const assertCertificateAllowedForHost = (
	host: string,
	certificateType: z.infer<typeof certificateTypeSchema>,
) => {
	if (certificateType === "letsencrypt" && isLocalWildcardHost(host)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"Let's Encrypt cannot issue certificates for *.traefik.me (it resolves to 127.0.0.1). Use certificate type “None” and open https://… — Traefik serves the self-signed default cert for local domains.",
		});
	}
};

/** A domain row with both possible parents eager-loaded for tenancy checks. */
const findDomain = (domainId: string) =>
	db.query.domains.findFirst({
		where: eq(domains.domainId, domainId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});

/**
 * Load a domain and verify org ownership through whichever service it is
 * attached to (domain → application|compose → environment → project → org).
 */
const assertDomainAccess = async (domainId: string, organizationId: string) => {
	const domain = await findDomain(domainId);
	const owner =
		domain?.application?.environment.project.organizationId ??
		domain?.compose?.environment.project.organizationId;
	if (!domain || owner !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found" });
	}
	return domain;
};

/** Verify a compose service belongs to the org (returns its context). */
const assertComposeAccess = async (composeId: string, organizationId: string) => {
	const context = await getServiceContext("compose", composeId);
	if (context.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Compose service not found" });
	}
	return context;
};

/**
 * Rewrite the Traefik file-provider config of the domain's parent service.
 * Preview domain rows belong to `<app>-pr-<n>.yml`, not the parent's file
 * (the parent sync filters them out), so they rewrite the preview's own YAML.
 */
const resyncServiceTraefik = async (domain: {
	applicationId: string | null;
	composeId: string | null;
	previewDeploymentId?: string | null;
}): Promise<void> => {
	if (domain.previewDeploymentId) {
		await syncPreviewTraefik(domain.previewDeploymentId);
		return;
	}
	if (domain.applicationId) {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, domain.applicationId),
		});
		if (application) {
			await syncApplicationTraefik(application);
		}
		return;
	}
	if (domain.composeId) {
		await resyncComposeDomains(domain.composeId);
	}
};

/** A domain may only reference a certificate owned by the same organization. */
const assertCertificateExists = async (
	certificateId: string,
	organizationId: string,
): Promise<void> => {
	const certificate = await db.query.certificates.findFirst({
		where: and(
			eq(certificates.certificateId, certificateId),
			eq(certificates.organizationId, organizationId),
		),
	});
	if (!certificate) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
	}
};

/**
 * Traefik routing is one shared namespace for the whole instance: two files
 * carrying routers for the same host steal traffic from each other (the
 * longer PathPrefix wins, equal rules are nondeterministic). The DB index
 * only covers (host, path, port) and NULL ports never conflict, so the
 * check is done here, case-folded and regardless of port:
 * - the same host + path on ANY other service (same org included) conflicts;
 * - a host already routed by ANOTHER organization conflicts on every path —
 *   a sub-path is exactly how a tenant would hijack `/api` of someone else's
 *   domain. Within one org, several services may share a host by path
 *   (frontend at `/`, API at `/api`).
 * The error never reveals who owns the conflicting row.
 */
const assertHostPathAvailable = async (
	host: string,
	path: string,
	organizationId: string,
	excludeDomainId?: string,
): Promise<void> => {
	const conditions = [sql`lower(${domains.host}) = lower(${host})`];
	if (excludeDomainId) {
		conditions.push(ne(domains.domainId, excludeDomainId));
	}
	const rows = await db.query.domains.findMany({
		where: and(...conditions),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	const wanted = path || "/";
	for (const row of rows) {
		const owner =
			row.application?.environment.project.organizationId ??
			row.compose?.environment.project.organizationId ??
			null;
		if (owner !== organizationId || (row.path ?? "/") === wanted) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "This host (or host + path) is already routed on this instance",
			});
		}
	}
};

/**
 * SSRF gate for `forwardAuth.address`. Two shapes are allowed:
 * - a bare container/service name (`http://authelia:9091/api/verify`) that
 *   belongs to an application or compose stack of the **same organization** —
 *   it never resolves in the panel's DNS, so the generic guard cannot see it;
 * - any other URL, which goes through `assertSafeOutboundUrl` with private
 *   ranges denied (no loopback, no RFC1918, no metadata).
 */
const assertForwardAuthAllowed = async (address: string, organizationId: string): Promise<void> => {
	const target = parseForwardAuthAddress(address);
	if (target.scope === "external") {
		try {
			await assertSafeOutboundUrl(target.url.toString(), { allowPrivate: false });
		} catch (error) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message:
					"forwardAuth must point at a public HTTPS endpoint or another service of this organization",
				cause: error,
			});
		}
		return;
	}
	const [applicationRows, composeRows] = await Promise.all([
		db
			.select({ appName: applications.appName })
			.from(applications)
			.innerJoin(environments, eq(applications.environmentId, environments.environmentId))
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(eq(projects.organizationId, organizationId)),
		db
			.select({ appName: compose.appName })
			.from(compose)
			.innerJoin(environments, eq(compose.environmentId, environments.environmentId))
			.innerJoin(projects, eq(environments.projectId, projects.projectId))
			.where(eq(projects.organizationId, organizationId)),
	]);
	const host = target.host;
	const owned =
		applicationRows.some((row) => row.appName.toLowerCase() === host) ||
		// Compose containers are `<appName>-<service>-1`.
		composeRows.some((row) => {
			const appName = row.appName.toLowerCase();
			return host === appName || host.startsWith(`${appName}-`);
		});
	if (!owned) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No service named “${host}” in this organization. Use the app name of a service you own, or a public HTTPS URL.`,
		});
	}
};

/** Postgres unique_violation → tRPC CONFLICT (host/path/port unique index). */
const rethrowUniqueViolation = (error: unknown): never => {
	if (isUniqueViolation(error)) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "A domain with this host, path and port already exists",
		});
	}
	throw error;
};

export const domainRouter = router({
	/**
	 * Does this host resolve to this server? The answer decides whether a new
	 * domain will ever work, and it is the first thing to check when one does
	 * not — so the panel asks before the operator has to learn `dig`.
	 *
	 * Advisory: DNS may still be propagating, and a host behind a CDN or a
	 * load balancer resolves elsewhere on purpose.
	 */
	checkDns: protectedProcedure
		.input(z.object({ host: z.string().min(1).max(253) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			// One lookup per second per org: the add-domain dialog calls this while
			// the operator types.
			if (
				!takeRateLimitToken(`domain-dns-check:${organizationId}`, { windowMs: 60_000, max: 60 })
			) {
				throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many DNS checks" });
			}
			const host = input.host.trim().toLowerCase().replace(/\.$/, "");
			if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) {
				return { host, resolved: [] as string[], serverIp: null, matches: false, checked: false };
			}
			const [v4, v6, serverIp] = await Promise.all([
				resolve4(host).catch(() => [] as string[]),
				resolve6(host).catch(() => [] as string[]),
				detectPublicIp(),
			]);
			return {
				host,
				resolved: [...v4, ...v6],
				serverIp,
				matches: serverIp !== null && v4.includes(serverIp),
				checked: true,
			};
		}),

	/** Domains for an application, compose, or (when neither set) a project. */
	all: protectedProcedure
		.input(
			z.object({
				applicationId: z.string().min(1).optional(),
				composeId: z.string().min(1).optional(),
				projectId: z.string().min(1).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			if (input.applicationId) {
				await assertApplicationAccess(input.applicationId, organizationId);
				return db.query.domains.findMany({
					where: eq(domains.applicationId, input.applicationId),
					orderBy: desc(domains.createdAt),
				});
			}
			if (input.composeId) {
				await assertComposeAccess(input.composeId, organizationId);
				return db.query.domains.findMany({
					where: eq(domains.composeId, input.composeId),
					orderBy: desc(domains.createdAt),
				});
			}
			if (input.projectId) {
				const project = await db.query.projects.findFirst({
					where: eq(projects.projectId, input.projectId),
				});
				if (!project || project.organizationId !== organizationId) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
				}
				const environmentRows = await db.query.environments.findMany({
					where: eq(environments.projectId, input.projectId),
					columns: { environmentId: true },
				});
				const environmentIds = environmentRows.map((row) => row.environmentId);
				if (environmentIds.length === 0) return [];
				const [applicationRows, composeRows] = await Promise.all([
					db.query.applications.findMany({
						where: inArray(applications.environmentId, environmentIds),
						columns: { applicationId: true },
					}),
					db.query.compose.findMany({
						where: inArray(compose.environmentId, environmentIds),
						columns: { composeId: true },
					}),
				]);
				const applicationIds = applicationRows.map((row) => row.applicationId);
				const composeIds = composeRows.map((row) => row.composeId);
				const filters = [
					...(applicationIds.length > 0 ? [inArray(domains.applicationId, applicationIds)] : []),
					...(composeIds.length > 0 ? [inArray(domains.composeId, composeIds)] : []),
				];
				if (filters.length === 0) return [];
				return db.query.domains.findMany({
					where: or(...filters),
					orderBy: desc(domains.createdAt),
				});
			}
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Provide applicationId, composeId, or projectId",
			});
		}),

	/** Domains of one application. */
	byApplication: protectedProcedure
		.input(z.object({ applicationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertApplicationAccess(input.applicationId, organizationId);
			return db.query.domains.findMany({
				where: eq(domains.applicationId, input.applicationId),
				orderBy: desc(domains.createdAt),
			});
		}),

	/** Domains of one compose service (all compose-file services). */
	byCompose: protectedProcedure
		.input(z.object({ composeId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertComposeAccess(input.composeId, organizationId);
			return db.query.domains.findMany({
				where: eq(domains.composeId, input.composeId),
				orderBy: desc(domains.createdAt),
			});
		}),

	one: protectedProcedure.input(domainIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const domain = await assertDomainAccess(input.domainId, organizationId);
		// Strip the eager-loaded parents from the response.
		const { application: _application, compose: _compose, ...row } = domain;
		return row;
	}),

	create: protectedProcedure
		.input(
			z
				.object({
					host: z.string().min(1).max(255),
					path: z.string().min(1).optional(),
					internalPath: z.string().nullable().optional(),
					port: z.number().int().min(1).max(65535).nullable().optional(),
					https: z.boolean().optional(),
					protocol: domainProtocolSchema.optional(),
					/** Named Traefik entrypoint; required for tcp/udp. */
					entrypoint: z.string().max(32).nullable().optional(),
					tlsMode: domainTlsModeSchema.optional(),
					certificateType: certificateTypeSchema.optional(),
					certificateId: z.string().nullable().optional(),
					/** Compose only: which compose-file service to route to. */
					serviceName: z.string().nullable().optional(),
					applicationId: z.string().optional(),
					composeId: z.string().optional(),
				})
				.refine((value) => Boolean(value.applicationId) !== Boolean(value.composeId), {
					message: "Exactly one of applicationId or composeId is required",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "domains.manage");

			if (input.applicationId) {
				await assertApplicationAccess(input.applicationId, organizationId);
			} else if (input.composeId) {
				await assertComposeAccess(input.composeId, organizationId);
				if (!input.serviceName) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "serviceName is required for compose domains",
					});
				}
			}

			const certificateType = input.certificateType ?? "none";
			const host = assertHostAllowingWildcard(input.host);
			const path = assertTraefikPath(input.path ?? "/") ?? "/";
			const internalPath = assertTraefikPath(input.internalPath);
			if (input.serviceName) {
				assertComposeServiceName(input.serviceName);
			}
			const route = await resolveRouteProtocol({
				protocol: input.protocol ?? "http",
				entrypoint: input.entrypoint,
				tlsMode: input.tlsMode,
				host,
			});
			assertNoHttpOnlyFields(route.protocol, {
				https: input.https,
				path: input.path,
				internalPath: input.internalPath,
			});
			// A layer-4 router never speaks HTTP-01, so the ACME guards below
			// only make sense once TLS is actually terminated by Traefik.
			if (route.protocol === "http" || route.tlsMode === "terminate") {
				assertCertificateAllowedForHost(host, certificateType);
			}
			await assertWildcardAllowed(ctx.session, host, certificateType);
			if (certificateType === "custom") {
				if (!input.certificateId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "certificateId is required when certificateType is custom",
					});
				}
				await assertCertificateExists(input.certificateId, organizationId);
			}
			await assertHostPathAvailable(host, path, organizationId);
			if (certificateType === "letsencrypt" && route.tlsMode !== "passthrough") {
				assertLetsEncryptBudget(organizationId);
			}

			const values = {
				host,
				path,
				internalPath,
				port: input.port ?? null,
				protocol: route.protocol,
				entrypoint: route.entrypoint,
				tlsMode: route.tlsMode,
				https: input.https ?? false,
				certificateType,
				certificateId: certificateType === "custom" ? (input.certificateId ?? null) : null,
				serviceName: input.composeId ? (input.serviceName ?? null) : null,
				domainType: input.applicationId ? ("application" as const) : ("compose" as const),
				uniqueConfigKey: randomBytes(6).toString("hex"),
				applicationId: input.applicationId ?? null,
				composeId: input.composeId ?? null,
			};

			let domain: typeof domains.$inferSelect | undefined;
			try {
				[domain] = await db.insert(domains).values(values).returning();
			} catch (error) {
				rethrowUniqueViolation(error);
			}
			if (!domain) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create domain",
				});
			}

			try {
				await resyncServiceTraefik(domain);
			} catch (error) {
				// Compensation: without it the client sees a 500 but the row exists,
				// and a retry hits the unique violation instead of creating cleanly.
				await db
					.delete(domains)
					.where(eq(domains.domainId, domain.domainId))
					.catch(() => {});
				throw error;
			}
			await auditFromSession(ctx, organizationId, {
				action: "domain.create",
				targetType: "domain",
				targetId: domain.domainId,
				targetName: domain.host,
			});
			return domain;
		}),

	update: protectedProcedure
		.input(
			domainIdInput.extend({
				host: z.string().min(1).max(255).optional(),
				path: z.string().min(1).optional(),
				internalPath: z.string().nullable().optional(),
				port: z.number().int().min(1).max(65535).nullable().optional(),
				https: z.boolean().optional(),
				protocol: domainProtocolSchema.optional(),
				entrypoint: z.string().max(32).nullable().optional(),
				tlsMode: domainTlsModeSchema.optional(),
				certificateType: certificateTypeSchema.optional(),
				certificateId: z.string().nullable().optional(),
				serviceName: z.string().nullable().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
			const existing = await assertDomainAccess(input.domainId, organizationId);

			const certificateType = input.certificateType ?? existing.certificateType;
			const nextHost =
				input.host !== undefined ? assertHostAllowingWildcard(input.host) : existing.host;
			const nextPath =
				input.path !== undefined ? (assertTraefikPath(input.path) ?? "/") : (existing.path ?? "/");
			if (input.internalPath !== undefined) {
				assertTraefikPath(input.internalPath);
			}
			if (input.serviceName) {
				assertComposeServiceName(input.serviceName);
			}
			const route = await resolveRouteProtocol({
				protocol: input.protocol ?? existing.protocol,
				entrypoint: input.entrypoint !== undefined ? input.entrypoint : existing.entrypoint,
				tlsMode: input.tlsMode ?? existing.tlsMode,
				host: nextHost,
			});
			assertNoHttpOnlyFields(route.protocol, {
				https: input.https ?? existing.https,
				path: input.path !== undefined ? nextPath : existing.path,
				internalPath: input.internalPath !== undefined ? input.internalPath : existing.internalPath,
			});
			if (route.protocol === "http" || route.tlsMode === "terminate") {
				assertCertificateAllowedForHost(nextHost, certificateType);
			}
			if (nextHost !== existing.host || certificateType !== existing.certificateType) {
				await assertWildcardAllowed(ctx.session, nextHost, certificateType);
			}
			if (
				certificateType === "letsencrypt" &&
				existing.certificateType !== "letsencrypt" &&
				route.tlsMode !== "passthrough"
			) {
				assertLetsEncryptBudget(organizationId);
			}
			const certificateId =
				certificateType === "custom" ? (input.certificateId ?? existing.certificateId) : null;
			if (certificateType === "custom") {
				if (!certificateId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "certificateId is required when certificateType is custom",
					});
				}
				await assertCertificateExists(certificateId, organizationId);
			}
			if (input.host !== undefined || input.path !== undefined) {
				await assertHostPathAvailable(nextHost, nextPath, organizationId, existing.domainId);
			}

			const { domainId, ...fields } = input;
			const data: Partial<typeof domains.$inferInsert> = {
				...fields,
				// Always written together: a protocol switch must clear the
				// entrypoint/TLS of the shape it left behind.
				protocol: route.protocol,
				entrypoint: route.entrypoint,
				tlsMode: route.tlsMode,
				...(input.host !== undefined ? { host: nextHost } : {}),
				...(input.path !== undefined ? { path: nextPath } : {}),
				...(input.internalPath !== undefined
					? { internalPath: assertTraefikPath(input.internalPath) }
					: {}),
				// serviceName only means something for compose domains; on an
				// application domain it would retarget the router to
				// `<app>-<name>-1`, a container that does not exist.
				serviceName: existing.composeId
					? input.serviceName !== undefined
						? input.serviceName
						: existing.serviceName
					: null,
				certificateType,
				certificateId,
			};

			let domain: typeof domains.$inferSelect | undefined;
			try {
				[domain] = await db
					.update(domains)
					.set(data)
					.where(eq(domains.domainId, domainId))
					.returning();
			} catch (error) {
				rethrowUniqueViolation(error);
			}
			if (!domain) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to update domain",
				});
			}

			try {
				await resyncServiceTraefik(domain);
			} catch (error) {
				// Compensation: restore the previous row so the client can retry
				// instead of finding a half-applied update behind the 500.
				const restore: Record<string, unknown> = {};
				for (const key of Object.keys(data)) {
					restore[key] = existing[key as keyof typeof existing];
				}
				await db
					.update(domains)
					.set(restore)
					.where(eq(domains.domainId, domainId))
					.catch(() => {});
				throw error;
			}
			return domain;
		}),

	delete: protectedProcedure.input(domainIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
		const domain = await assertDomainAccess(input.domainId, organizationId);

		await db.delete(domains).where(eq(domains.domainId, input.domainId));
		// Rewrites the parent's config; with no domains left the file is removed.
		await resyncServiceTraefik(domain);
		await auditFromSession(ctx, organizationId, {
			action: "domain.delete",
			targetType: "domain",
			targetId: input.domainId,
			targetName: domain.host,
		});
		return { domainId: input.domainId };
	}),

	/** Middleware rows attached to one domain, in chain order. */
	middlewares: protectedProcedure.input(domainIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertDomainAccess(input.domainId, organizationId);
		return db.query.domainMiddlewares.findMany({
			where: eq(domainMiddlewares.domainId, input.domainId),
			orderBy: [domainMiddlewares.order, domainMiddlewares.createdAt],
		});
	}),

	/**
	 * Replace the middleware chain of one domain. Replace-all (not per-row
	 * CRUD) so reordering, adding and removing are one atomic write and the
	 * Traefik file is rewritten exactly once.
	 */
	saveMiddlewares: protectedProcedure
		.input(
			domainIdInput.extend({
				middlewares: z
					.array(
						z.object({
							kind: domainMiddlewareKindSchema,
							config: z.unknown().optional(),
							enabled: z.boolean().default(true),
						}),
					)
					.max(20),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "domains.manage");
			const domain = await assertDomainAccess(input.domainId, organizationId);

			// Validate every config BEFORE touching the table, so a bad row never
			// leaves the chain half-written (Traefik would then drop the route).
			const validated: Array<{
				kind: (typeof input.middlewares)[number]["kind"];
				config: unknown;
				enabled: boolean;
			}> = [];
			for (const row of input.middlewares) {
				const config = parseMiddlewareConfig(row.kind, row.config ?? {});
				if (row.kind === "forwardAuth") {
					await assertForwardAuthAllowed((config as { address: string }).address, organizationId);
				}
				validated.push({ kind: row.kind, config, enabled: row.enabled });
			}

			const previous = await db.query.domainMiddlewares.findMany({
				where: eq(domainMiddlewares.domainId, input.domainId),
			});
			await db.transaction(async (tx) => {
				await tx.delete(domainMiddlewares).where(eq(domainMiddlewares.domainId, input.domainId));
				if (validated.length > 0) {
					await tx.insert(domainMiddlewares).values(
						validated.map((row, index) => ({
							domainId: input.domainId,
							kind: row.kind,
							config: row.config,
							order: index,
							enabled: row.enabled,
						})),
					);
				}
			});

			try {
				await resyncServiceTraefik(domain);
			} catch (error) {
				// Compensation: put the old chain back so the live config and the
				// rows agree even when the rewrite failed.
				await db
					.transaction(async (tx) => {
						await tx
							.delete(domainMiddlewares)
							.where(eq(domainMiddlewares.domainId, input.domainId));
						if (previous.length > 0) {
							await tx.insert(domainMiddlewares).values(
								previous.map((row) => ({
									domainId: row.domainId,
									kind: row.kind,
									config: row.config,
									order: row.order,
									enabled: row.enabled,
								})),
							);
						}
					})
					.catch(() => {});
				throw error;
			}

			await auditFromSession(ctx, organizationId, {
				action: "domain.saveMiddlewares",
				targetType: "domain",
				targetId: domain.domainId,
				targetName: domain.host,
				metadata: { kinds: validated.map((row) => row.kind) },
			});
			return db.query.domainMiddlewares.findMany({
				where: eq(domainMiddlewares.domainId, input.domainId),
				orderBy: [domainMiddlewares.order, domainMiddlewares.createdAt],
			});
		}),

	/**
	 * Free wildcard domain (`traefik.me` resolves any *.traefik.me to
	 * 127.0.0.1): `<appName>-<random>.traefik.me`.
	 */
	generateDomain: protectedProcedure
		.input(z.object({ appName: z.string().optional() }).optional())
		.query(({ input }) => {
			const base =
				(input?.appName ?? "")
					.toLowerCase()
					.replace(/[^a-z0-9-]/g, "-")
					.replace(/-+/g, "-")
					.replace(/^-|-$/g, "") || "app";
			return `${base}-${randomBytes(4).toString("hex")}.traefik.me`;
		}),

	/**
	 * Host uniqueness check across the whole platform — Traefik routing is a
	 * shared resource. Returns whether the host is available to the caller
	 * without revealing whether a conflict is same-org or cross-tenant.
	 */
	validateHost: protectedProcedure
		.input(z.object({ host: z.string().min(1), domainId: z.string().optional() }))
		.query(async ({ input }) => {
			const conditions = [eq(domains.host, input.host)];
			if (input.domainId) {
				conditions.push(ne(domains.domainId, input.domainId));
			}
			const existing = await db.query.domains.findFirst({
				where: and(...conditions),
			});
			// Always a boolean — never leak which org owns a conflicting host.
			return !existing;
		}),
});
