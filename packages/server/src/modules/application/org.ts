import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, environments, members } from "../../db/schema";
import type { TRPCContext } from "../../trpc/init";
import { notFound } from "../errors";
import { resolveCallerOrganizationId } from "../projects";
import { SERVICE_REGISTRY, type ServiceKind } from "../services/registry";

type Session = NonNullable<TRPCContext["session"]>;

/** Per-request cache keyed by the session object shared across tRPC procedures. */
const organizationIdBySession = new WeakMap<object, Promise<string>>();

/**
 * Active organization of the request. Falls back to the caller's first
 * membership when the session has no active organization (e.g. stale
 * sessions created before org selection); hard-fails only when the user
 * belongs to no organization at all.
 *
 * Memoized per session object so batched tRPC procedures share one membership
 * query. Outside tRPC (crons, webhooks) each call still resolves normally when
 * sessions are distinct objects.
 */
export const getOrganizationId = (session: Session): Promise<string> => {
	const cached = organizationIdBySession.get(session);
	if (cached) return cached;
	const promise = resolveCallerOrganizationId(
		session.user.id,
		session.session.activeOrganizationId,
	);
	organizationIdBySession.set(session, promise);
	return promise;
};

export type ApplicationWithTenancy = NonNullable<Awaited<ReturnType<typeof findApplication>>>;

export const findApplication = async (applicationId: string) =>
	db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
		with: { environment: { with: { project: true } } },
	});

/**
 * Load an application and verify it belongs to `organizationId`
 * (application → environment → project → organization).
 */
export const assertApplicationAccess = async (
	applicationId: string,
	organizationId: string,
): Promise<ApplicationWithTenancy> => {
	const application = await findApplication(applicationId);
	if (!application || application.environment.project.organizationId !== organizationId) {
		throw notFound("Application not found");
	}
	return application;
};

/**
 * Load an application by its unique `appName` for a caller identified only by
 * a user id (API-key surfaces such as the generic deploy webhook), verifying
 * the caller is a member of the owning organization. Returns null when the
 * app does not exist or belongs to another tenant — callers must not
 * distinguish the two, so the app name cannot be probed across orgs.
 */
export const findApplicationByAppNameForUser = async (
	appName: string,
	userId: string,
): Promise<ApplicationWithTenancy | null> => {
	const application = await db.query.applications.findFirst({
		where: eq(applications.appName, appName),
		with: { environment: { with: { project: true } } },
	});
	if (!application) return null;
	const membership = await db.query.members.findFirst({
		where: and(
			eq(members.userId, userId),
			eq(members.organizationId, application.environment.project.organizationId),
		),
	});
	return membership ? application : null;
};

/**
 * The id twin of `findApplicationByAppNameForUser`, for the surfaces that
 * identify an application by id and a caller by user id alone (the drop
 * upload route). Same contract: null covers both "does not exist" and
 * "belongs to another tenant", so neither can be probed.
 */
export const findApplicationForUser = async (
	applicationId: string,
	userId: string,
): Promise<ApplicationWithTenancy | null> => {
	const application = await findApplication(applicationId);
	if (!application) return null;
	const membership = await db.query.members.findFirst({
		where: and(
			eq(members.userId, userId),
			eq(members.organizationId, application.environment.project.organizationId),
		),
	});
	return membership ? application : null;
};

/** Load an environment and verify org ownership. */
export const assertEnvironmentAccess = async (environmentId: string, organizationId: string) => {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	if (!environment || environment.project.organizationId !== organizationId) {
		throw notFound("Environment not found");
	}
	return environment;
};

/** Find an environment by project + name, verifying org ownership. */
export const findEnvironmentByName = async (
	projectId: string,
	environmentName: string,
	organizationId: string,
) => {
	const environment = await db.query.environments.findFirst({
		where: and(eq(environments.projectId, projectId), eq(environments.name, environmentName)),
		with: { project: true },
	});
	if (!environment || environment.project.organizationId !== organizationId) {
		throw notFound("Environment not found");
	}
	return environment;
};

/** @deprecated Use `ServiceKind` from `modules/services/registry`. */
export type ServiceType = ServiceKind;

export interface ServiceContext {
	serviceId: string;
	appName: string;
	serverId: string | null;
	organizationId: string;
}

/**
 * Resolve any mountable/portable service to its tenancy context.
 * Every mount/port mutation is org-scoped through this.
 */
export const getServiceContext = async (
	serviceType: ServiceKind,
	serviceId: string,
): Promise<ServiceContext> => {
	const row = await SERVICE_REGISTRY[serviceType].module.findTenancy(serviceId);
	if (!row) {
		throw notFound(`${serviceType} service not found`);
	}
	return {
		serviceId,
		appName: row.appName,
		serverId: row.serverId,
		organizationId: row.organizationId,
	};
};
