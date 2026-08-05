import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, mariadb, mongo, mysql, postgres, redis } from "../../db/schema";

/** Convert a display name into a dns-safe slug (swarm service names). */
export const slugifyName = (name: string): string =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "app";

/** appName must be unique across every deployable service kind. */
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
