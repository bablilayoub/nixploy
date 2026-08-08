import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
	applications,
	certificates,
	compose,
	domains,
	environments,
	projects,
} from "../../db/schema";
import {
	assertApplicationAccess,
	getOrganizationId,
	getServiceContext,
	syncApplicationTraefik,
} from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { resyncComposeDomains } from "../../modules/compose/service";
import { assertCapability } from "../../modules/projects";
import {
	assertComposeServiceName,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";
import { protectedProcedure, router } from "../init";

const domainIdInput = z.object({ domainId: z.string().min(1) });

const certificateTypeSchema = z.enum(["letsencrypt", "none", "custom"]);

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

/** Rewrite the Traefik file-provider config of the domain's parent service. */
const resyncServiceTraefik = async (domain: {
	applicationId: string | null;
	composeId: string | null;
}): Promise<void> => {
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

/** Postgres unique_violation → tRPC CONFLICT (host/path/port unique index). */
const rethrowUniqueViolation = (error: unknown): never => {
	if (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: string }).code === "23505"
	) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "A domain with this host, path and port already exists",
		});
	}
	throw error;
};

export const domainRouter = router({
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
			let host: string;
			let path: string;
			let internalPath: string | null;
			try {
				host = assertTraefikHost(input.host);
				path = assertTraefikPath(input.path ?? "/") ?? "/";
				internalPath = assertTraefikPath(input.internalPath);
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error.message : "Invalid domain host/path",
				});
			}
			if (input.serviceName) {
				try {
					assertComposeServiceName(input.serviceName);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: error instanceof Error ? error.message : "Invalid serviceName",
					});
				}
			}
			assertCertificateAllowedForHost(host, certificateType);
			if (certificateType === "custom") {
				if (!input.certificateId) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "certificateId is required when certificateType is custom",
					});
				}
				await assertCertificateExists(input.certificateId, organizationId);
			}

			const values = {
				host,
				path,
				internalPath,
				port: input.port ?? null,
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

			await resyncServiceTraefik(domain);
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
			let nextHost: string;
			try {
				nextHost = input.host !== undefined ? assertTraefikHost(input.host) : existing.host;
				if (input.path !== undefined) {
					assertTraefikPath(input.path);
				}
				if (input.internalPath !== undefined) {
					assertTraefikPath(input.internalPath);
				}
				if (input.serviceName) {
					assertComposeServiceName(input.serviceName);
				}
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: error instanceof Error ? error.message : "Invalid domain host/path",
				});
			}
			assertCertificateAllowedForHost(nextHost, certificateType);
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

			const { domainId, ...fields } = input;
			const data: Partial<typeof domains.$inferInsert> = {
				...fields,
				...(input.host !== undefined ? { host: nextHost } : {}),
				...(input.path !== undefined ? { path: assertTraefikPath(input.path) ?? "/" } : {}),
				...(input.internalPath !== undefined
					? { internalPath: assertTraefikPath(input.internalPath) }
					: {}),
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

			await resyncServiceTraefik(domain);
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
