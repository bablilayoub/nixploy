import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import { saveEnvironment as saveApplicationEnvironment } from "../application/service";
import { saveEnvironment as saveComposeEnvironment } from "../compose/service";
import { queueDeployment } from "../deployment";
import { extractEnvEntries, mergeDotenv } from "./apply-patch";
import { readCachedExplanation } from "./explanation-cache";

export type ApplyPatchResult = {
	appliedKeys: string[];
	deploymentId: string | null;
};

/**
 * Apply an env-like Copilot patch to the deployment's application or compose,
 * optionally queueing a redeploy.
 */
export async function applySuggestedEnvPatch(options: {
	deploymentId: string;
	organizationId: string;
	patch?: string | null;
	redeploy?: boolean;
}): Promise<ApplyPatchResult> {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, options.deploymentId),
		with: {
			application: { with: { environment: { with: { project: true } } } },
			compose: { with: { environment: { with: { project: true } } } },
		},
	});
	const orgId =
		deployment?.application?.environment.project.organizationId ??
		deployment?.compose?.environment.project.organizationId;
	if (!deployment || orgId !== options.organizationId) {
		throw new Error("Deployment not found");
	}

	let patch = options.patch?.trim() || null;
	if (!patch && deployment.logPath) {
		const cached = await readCachedExplanation(deployment.logPath);
		patch = cached?.suggestedPatch ?? null;
	}
	if (!patch) {
		throw new Error("No suggested patch available to apply");
	}

	const keys = extractEnvEntries(patch).map((entry) => entry.key);
	if (keys.length === 0) {
		throw new Error("Suggested patch has no KEY=VALUE environment lines to apply");
	}

	if (deployment.application) {
		const next = mergeDotenv(deployment.application.env, patch);
		await saveApplicationEnvironment(deployment.application.applicationId, next);
		const deploymentId =
			options.redeploy === false
				? null
				: await queueDeployment({
						applicationId: deployment.application.applicationId,
						type: "redeploy",
					});
		return { appliedKeys: keys, deploymentId };
	}

	if (deployment.compose) {
		const next = mergeDotenv(deployment.compose.env, patch);
		await saveComposeEnvironment(deployment.compose.composeId, next);
		const deploymentId =
			options.redeploy === false
				? null
				: await queueDeployment({
						composeId: deployment.compose.composeId,
						type: "redeploy",
					});
		return { appliedKeys: keys, deploymentId };
	}

	throw new Error("Deployment is not linked to an application or compose service");
}
