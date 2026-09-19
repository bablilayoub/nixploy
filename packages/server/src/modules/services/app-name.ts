import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
	applications,
	compose,
	domains,
	externalUpstreams,
	mariadb,
	mongo,
	mysql,
	postgres,
	previewDeployments,
	redis,
} from "../../db/schema";
import { conflict } from "../errors";

/**
 * Longest slug `generateAppName` produces. Swarm service names and DNS
 * labels cap at 63 chars; the slug still gets `-<6 hex>` and previews add
 * `-pr-<n>` (service) / `pr-<n>-` (host label), so leave room for both.
 */
export const MAX_APP_NAME_SLUG_LENGTH = 40;

/**
 * Convert a display name into a dns-safe slug (swarm service names).
 * `fallback` is what an all-punctuation name collapses to.
 */
export const slugifyName = (name: string, fallback = "app"): string =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_APP_NAME_SLUG_LENGTH)
		.replace(/-+$/g, "") || fallback;

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
		db.query.externalUpstreams.findFirst({
			where: eq(externalUpstreams.appName, appName),
			columns: { externalUpstreamId: true },
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

/** Six hex characters — the disambiguating suffix of every generated appName. */
export const randomAppNameSuffix = (): string => randomBytes(3).toString("hex");

/**
 * Generate a unique appName for a service: `<slug>-<6 hex chars>`,
 * retried on the (astronomically unlikely) collision. Shared by applications,
 * compose stacks and databases — the namespace is one, so the generator is too.
 */
export const generateAppName = async (name: string, fallback = "app"): Promise<string> => {
	const slug = slugifyName(name, fallback);
	for (let attempt = 0; attempt < 10; attempt++) {
		const candidate = `${slug}-${randomAppNameSuffix()}`;
		if (!(await isAppNameTaken(candidate))) {
			return candidate;
		}
	}
	throw conflict(`Could not generate a unique appName for "${name}"`);
};
