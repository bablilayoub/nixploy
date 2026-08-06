import { eq } from "drizzle-orm";
import { db } from "../db";
import {
	applications,
	compose,
	deployments,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
} from "../db/schema";
import { findServerById } from "../modules/cluster/servers";
import { resolveCallerOrganizationId } from "../modules/projects";
import type { WsSession } from "./auth";

const withTenancy = {
	with: { environment: { with: { project: true } } },
} as const;

/**
 * Resolve the caller's org from the websocket session (same fallback rules
 * as tRPC protected procedures).
 */
export async function resolveWsOrganizationId(session: WsSession): Promise<string> {
	return resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

/**
 * Verify `appName` belongs to a service in the caller's org. App names are
 * globally unique, so a miss or cross-tenant hit both return the same error.
 */
async function assertWsAppAccess(appName: string, organizationId: string): Promise<void> {
	const matchers = [
		db.query.applications.findFirst({
			where: eq(applications.appName, appName),
			...withTenancy,
		}),
		db.query.compose.findFirst({
			where: eq(compose.appName, appName),
			...withTenancy,
		}),
		db.query.postgres.findFirst({
			where: eq(postgres.appName, appName),
			...withTenancy,
		}),
		db.query.mysql.findFirst({
			where: eq(mysql.appName, appName),
			...withTenancy,
		}),
		db.query.mariadb.findFirst({
			where: eq(mariadb.appName, appName),
			...withTenancy,
		}),
		db.query.mongo.findFirst({
			where: eq(mongo.appName, appName),
			...withTenancy,
		}),
		db.query.redis.findFirst({
			where: eq(redis.appName, appName),
			...withTenancy,
		}),
	] as const;

	const rows = await Promise.all(matchers);
	const row = rows.find(Boolean);
	if (!row || row.environment.project.organizationId !== organizationId) {
		throw new Error(`Service not found: ${appName}`);
	}
}

/**
 * Verify optional remote `serverId` belongs to the caller's org before SSH.
 */
async function assertWsServerAccess(
	serverId: string | null | undefined,
	organizationId: string,
): Promise<void> {
	if (!serverId) return;
	const server = await findServerById(serverId, organizationId);
	if (!server) {
		throw new Error(`Server not found: ${serverId}`);
	}
}

/**
 * Verify a deployment belongs to the caller's org via application or compose.
 */
export async function assertWsDeploymentAccess(
	deploymentId: string,
	organizationId: string,
): Promise<typeof deployments.$inferSelect> {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	const owner =
		deployment?.application?.environment.project.organizationId ??
		deployment?.compose?.environment.project.organizationId;
	if (!deployment || owner !== organizationId) {
		throw new Error(`Deployment not found: ${deploymentId}`);
	}
	return deployment;
}

/**
 * Combined gate for /ws/{logs,stats,terminal}: org membership + app + optional server.
 */
export async function assertWsContainerAccess(
	session: WsSession,
	appName: string,
	serverId: string | null | undefined,
): Promise<void> {
	const organizationId = await resolveWsOrganizationId(session);
	await assertWsAppAccess(appName, organizationId);
	await assertWsServerAccess(serverId, organizationId);
}
