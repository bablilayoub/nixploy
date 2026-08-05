import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	environments,
	mariadb,
	members,
	mongo,
	mysql,
	postgres,
	redis,
} from "../../db/schema";
import type { TRPCContext } from "../../trpc/init";
import { resolveCallerOrganizationId } from "../projects";

type Session = NonNullable<TRPCContext["session"]>;

/**
 * Active organization of the request. Falls back to the caller's first
 * membership when the session has no active organization (e.g. stale
 * sessions created before org selection); hard-fails only when the user
 * belongs to no organization at all.
 */
export const getOrganizationId = (session: Session): Promise<string> =>
	resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);

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
		throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
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

/** Load an environment and verify org ownership. */
export const assertEnvironmentAccess = async (environmentId: string, organizationId: string) => {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		with: { project: true },
	});
	if (!environment || environment.project.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
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
		throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found" });
	}
	return environment;
};

export type ServiceType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis";

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
	serviceType: ServiceType,
	serviceId: string,
): Promise<ServiceContext> => {
	const withTenancy = {
		with: { environment: { with: { project: true } } },
	} as const;

	let row:
		| {
				appName: string;
				serverId: string | null;
				environment: { project: { organizationId: string } };
		  }
		| undefined;

	switch (serviceType) {
		case "application":
			row = await db.query.applications.findFirst({
				where: eq(applications.applicationId, serviceId),
				...withTenancy,
			});
			break;
		case "compose":
			row = await db.query.compose.findFirst({
				where: eq(compose.composeId, serviceId),
				...withTenancy,
			});
			break;
		case "postgres":
			row = await db.query.postgres.findFirst({
				where: eq(postgres.postgresId, serviceId),
				...withTenancy,
			});
			break;
		case "mysql":
			row = await db.query.mysql.findFirst({
				where: eq(mysql.mysqlId, serviceId),
				...withTenancy,
			});
			break;
		case "mariadb":
			row = await db.query.mariadb.findFirst({
				where: eq(mariadb.mariadbId, serviceId),
				...withTenancy,
			});
			break;
		case "mongo":
			row = await db.query.mongo.findFirst({
				where: eq(mongo.mongoId, serviceId),
				...withTenancy,
			});
			break;
		case "redis":
			row = await db.query.redis.findFirst({
				where: eq(redis.redisId, serviceId),
				...withTenancy,
			});
			break;
	}

	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: `${serviceType} service not found` });
	}
	return {
		serviceId,
		appName: row.appName,
		serverId: row.serverId,
		organizationId: row.environment.project.organizationId,
	};
};
