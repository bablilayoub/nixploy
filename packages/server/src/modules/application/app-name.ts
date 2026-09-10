import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	domains,
	mariadb,
	mongo,
	mysql,
	postgres,
	previewDeployments,
	redis,
} from "../../db/schema";

/**
 * Longest slug `generateAppName` produces. Swarm service names and DNS
 * labels cap at 63 chars; the slug still gets `-<6 hex>` and previews add
 * `-pr-<n>` (service) / `pr-<n>-` (host label), so leave room for both.
 */
export const MAX_APP_NAME_SLUG_LENGTH = 40;

/** Convert a display name into a dns-safe slug (swarm service names). */
export const slugifyName = (name: string): string =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_APP_NAME_SLUG_LENGTH)
		.replace(/-+$/g, "") || "app";

/**
 * appName must be unique across every deployable service kind — including
 * live PR preview variants (`<app>-pr-<n>` swarm services + Traefik files)
 * and the Traefik keys compose domains are written under
 * (`<compose>-<service>` / `<compose>_<service>`), which share the dynamic
 * directory with application YAML.
 */
export const isAppNameTaken = async (appName: string): Promise<boolean> => {
	const checks = await Promise.all([
		db.query.applications.findFirst({
			where: eq(applications.appName, appName),
			columns: { applicationId: true },
		}),
		db.query.compose.findFirst({
			where: eq(compose.appName, appName),
			columns: { composeId: true },
		}),
		db.query.postgres.findFirst({
			where: eq(postgres.appName, appName),
			columns: { postgresId: true },
		}),
		db.query.mysql.findFirst({
			where: eq(mysql.appName, appName),
			columns: { mysqlId: true },
		}),
		db.query.mariadb.findFirst({
			where: eq(mariadb.appName, appName),
			columns: { mariadbId: true },
		}),
		db.query.mongo.findFirst({
			where: eq(mongo.appName, appName),
			columns: { mongoId: true },
		}),
		db.query.redis.findFirst({
			where: eq(redis.appName, appName),
			columns: { redisId: true },
		}),
		db.query.previewDeployments.findFirst({
			where: eq(previewDeployments.appName, appName),
			columns: { previewDeploymentId: true },
		}),
		db
			.select({ domainId: domains.domainId })
			.from(domains)
			.innerJoin(compose, eq(domains.composeId, compose.composeId))
			.where(
				sql`${domains.serviceName} is not null and (${compose.appName} || '-' || ${domains.serviceName} = ${appName} or ${compose.appName} || '_' || ${domains.serviceName} = ${appName})`,
			)
			.limit(1)
			.then((rows) => rows[0]),
	]);
	return checks.some(Boolean);
};

/**
 * Generate a unique appName for a service: `<slug>-<6 hex chars>`,
 * retried on the (astronomically unlikely) collision.
 */
export const generateAppName = async (name: string): Promise<string> => {
	const slug = slugifyName(name);
	for (let attempt = 0; attempt < 10; attempt++) {
		const candidate = `${slug}-${randomBytes(3).toString("hex")}`;
		if (!(await isAppNameTaken(candidate))) {
			return candidate;
		}
	}
	throw new Error(`Could not generate a unique appName for "${name}"`);
};
