import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { rollbacks } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import type { DeploymentContext } from "./context";
import { getDocker } from "./docker";
import { shellQuote } from "./paths";

/** Rollback targets kept per application; older pins (rows + local tags) are pruned. */
export const ROLLBACK_HISTORY_LIMIT = 5;

/** Short, tag-safe version label derived from the deployment id. */
export function rollbackVersion(deploymentId: string): string {
	return (
		deploymentId
			.replace(/[^a-zA-Z0-9]/g, "")
			.slice(0, 12)
			.toLowerCase() || "unknown"
	);
}

/** Local image tag a built deployment is pinned under. */
export const rollbackImageTag = (appName: string, deploymentId: string): string =>
	`${appName}:${rollbackVersion(deploymentId)}`;

/**
 * Pin the image a successful deployment runs so it can be rolled back to.
 * - Built images: every build overwrites the mutable `appName:latest`, so it
 *   is retagged `appName:<version>` (survives `docker image prune` — only
 *   dangling images are pruned) and the pin points at that immutable tag.
 * - Docker-source apps: the pulled reference is resolved to its repo digest
 *   when the registry provided one, since `nginx:latest` moves under our
 *   feet; otherwise the reference itself is recorded.
 */
export async function pinRollbackImage(
	ctx: DeploymentContext,
	application: { appName: string; sourceType: string },
	deploymentId: string,
	imageTag: string,
	options: {
		/**
		 * Reference the build was pushed to (`modules/deployment/push.ts`).
		 * It is already immutable AND reachable from every node, so it beats a
		 * local `appName:<version>` tag that only exists on the build host.
		 */
		pushedRef?: string | null;
	} = {},
): Promise<string> {
	if (options.pushedRef) return options.pushedRef;
	if (application.sourceType === "docker") {
		try {
			const docker = await getDocker(ctx.serverId);
			const info = await docker.getImage(imageTag).inspect();
			const digest = info.RepoDigests?.[0];
			if (digest) return digest;
		} catch {
			// digest unavailable (local-only image) — keep the mutable reference
		}
		return imageTag;
	}
	const pinned = rollbackImageTag(application.appName, deploymentId);
	await ctx.run(`docker tag ${shellQuote(imageTag)} ${shellQuote(pinned)}`);
	return pinned;
}

export interface RecordRollbackInput {
	applicationId: string;
	appName: string;
	deploymentId: string;
	/** Image reference the service runs after this deployment. */
	image: string;
	serverId: string | null;
	/** Free-form context shown alongside the pin (source, branch, ...). */
	fullContext?: Record<string, unknown> | null;
}

/**
 * Record a successful deployment as a rollback target and trim the history
 * to the newest {@link ROLLBACK_HISTORY_LIMIT} entries. Pruned pins that are
 * local `appName:<version>` tags are untagged too (best effort — an image
 * still used by a task is left alone by the engine); registry refs/digests
 * are never touched.
 */
export async function recordRollback(input: RecordRollbackInput): Promise<void> {
	await db.insert(rollbacks).values({
		image: input.image,
		version: rollbackVersion(input.deploymentId),
		fullContext: input.fullContext ? JSON.stringify(input.fullContext) : null,
		applicationId: input.applicationId,
		deploymentId: input.deploymentId,
	});

	const rows = await db.query.rollbacks.findMany({
		where: eq(rollbacks.applicationId, input.applicationId),
		orderBy: desc(rollbacks.createdAt),
		columns: { rollbackId: true, image: true },
	});
	const stale = rows.slice(ROLLBACK_HISTORY_LIMIT);
	if (stale.length === 0) return;

	await db.delete(rollbacks).where(
		inArray(
			rollbacks.rollbackId,
			stale.map((row) => row.rollbackId),
		),
	);
	const localTags = stale
		.map((row) => row.image)
		.filter((image) => image.startsWith(`${input.appName}:`));
	if (localTags.length === 0) return;
	const command = `docker image rm ${localTags.map(shellQuote).join(" ")} >/dev/null 2>&1 || true`;
	await (input.serverId ? execAsyncRemote(input.serverId, command) : execAsync(command)).catch(
		() => {
			// best effort — a missing tag or an in-use image is not a deploy failure
		},
	);
}
