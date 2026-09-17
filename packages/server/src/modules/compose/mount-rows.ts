import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { mounts } from "../../db/schema";
import { resolveFileMountPath } from "../application/paths";
import type { ComposeMount } from "./mounts";

/** Mount rows belonging to one compose stack, oldest first. */
export async function loadComposeMounts(composeId: string) {
	return await db.query.mounts.findMany({
		where: and(eq(mounts.composeId, composeId), eq(mounts.serviceType, "compose")),
		orderBy: mounts.createdAt,
	});
}

type MountRow = Awaited<ReturnType<typeof loadComposeMounts>>[number];

/**
 * Reduce mount rows to what the compose injection needs.
 *
 * A row with no `serviceName` cannot be placed — a stack has many containers —
 * so it is dropped rather than guessed at. `file` mounts resolve to the
 * absolute path Nixploy wrote them to, which is also the containment check.
 */
export function toComposeMounts(appName: string, rows: readonly MountRow[]): ComposeMount[] {
	const out: ComposeMount[] = [];
	for (const row of rows) {
		if (!row.serviceName) continue;
		out.push({
			serviceName: row.serviceName,
			type: row.type,
			volumeName: row.volumeName,
			hostPath:
				row.type === "file" && row.filePath
					? resolveFileMountPath(appName, row.filePath)
					: row.hostPath,
			mountPath: row.mountPath,
		});
	}
	return out;
}
