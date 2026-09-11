import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { applications, deployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { fetchRemoteDigest, normalizeDigest } from "../updates/registry";
import { queueDeployment } from "./index";

const log = createLogger("image-auto-update");

/**
 * Docker-image auto-update (product audit, Deploy row "docker-image
 * auto-update"). Watchtower in one cron: every hour, for every docker-source
 * application that opted in, ask the registry what `nginx:latest` currently
 * resolves to and redeploy when that digest moved.
 *
 * The comparison baseline is the digest the deploy worker already records on
 * a successful docker deployment (`deployment.commit_sha`, filled by
 * `resolveImageDigest`), so nothing new has to be stored. An application that
 * has never deployed successfully is skipped — auto-update keeps a service
 * current, it does not perform its first rollout.
 *
 * Private registries are out of scope: `fetchRemoteDigest` is an anonymous
 * token client, so it returns null for an image that needs credentials and
 * the application is quietly left alone.
 */

/** Digest of the newest successful deployment of this application, if any. */
export async function lastDeployedDigest(applicationId: string): Promise<string | null> {
	const row = await db.query.deployments.findFirst({
		where: and(
			eq(deployments.applicationId, applicationId),
			eq(deployments.status, "done"),
			isNotNull(deployments.commitSha),
		),
		orderBy: [desc(deployments.createdAt)],
		columns: { commitSha: true },
	});
	return normalizeDigest(row?.commitSha);
}

export interface AutoUpdateResult {
	/** Applications with the flag set that were examined. */
	checked: number;
	/** Deployments queued because the remote digest moved. */
	queued: number;
}

/** One pass: check every opted-in docker application and enqueue what moved. */
export async function runImageAutoUpdate(): Promise<AutoUpdateResult> {
	const rows = await db.query.applications.findMany({
		where: and(
			eq(applications.autoUpdateImage, true),
			eq(applications.sourceType, "docker"),
			isNotNull(applications.dockerImage),
		),
		columns: {
			applicationId: true,
			appName: true,
			dockerImage: true,
		},
	});

	let queued = 0;
	for (const row of rows) {
		const image = row.dockerImage?.trim();
		if (!image) continue;
		try {
			const remote = await fetchRemoteDigest(image);
			if (!remote) continue;
			const current = await lastDeployedDigest(row.applicationId);
			// No successful deployment yet → nothing to keep up to date.
			if (!current || current === remote) continue;
			await queueDeployment({
				applicationId: row.applicationId,
				type: "redeploy",
				title: "Auto-update: new image digest",
				trigger: "system",
				triggeredBy: "system",
				commitSha: remote,
			});
			queued += 1;
			log.info(`Queued auto-update for ${row.appName}`, { image, digest: remote });
		} catch (error) {
			log.error(`Auto-update check failed for ${row.appName}`, {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { checked: rows.length, queued };
}

/** Hourly cron, registered from `apps/web/server.ts` alongside the others. */
export async function initImageAutoUpdate(): Promise<void> {
	const schedule = (await import("node-schedule")).default;
	let inFlight = false;
	schedule.scheduleJob("image-auto-update", "7 * * * *", () => {
		if (inFlight) return; // registry round-trips can outlive an hour on a big fleet
		inFlight = true;
		void runImageAutoUpdate()
			.catch((error: unknown) => {
				log.error("Image auto-update pass failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				inFlight = false;
			});
	});
}
