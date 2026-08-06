import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import { explainDeploymentFailure } from "./explain";
import {
	appendExplanationToLog,
	readCachedExplanation,
	writeCachedExplanation,
} from "./explanation-cache";
import { getAiSettings } from "./settings";

/**
 * If Deploy Copilot is enabled with auto-explain, analyze a failed deploy,
 * cache the result beside the log, and append a short summary to the log.
 * Safe to fire-and-forget from the deploy worker.
 */
export async function maybeAutoExplainOnFailure(
	deploymentId: string,
	organizationId: string,
): Promise<void> {
	const settings = await getAiSettings();
	if (!settings.enabled || !settings.autoExplainOnFailure) return;

	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
	});
	if (!deployment?.logPath || deployment.status !== "error") return;

	const existing = await readCachedExplanation(deployment.logPath);
	if (existing) return;

	const result = await explainDeploymentFailure(deploymentId, organizationId);
	await writeCachedExplanation(deployment.logPath, result);
	await appendExplanationToLog(deployment.logPath, result).catch(() => {});
}
