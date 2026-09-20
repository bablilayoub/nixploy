import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments, rollbacks } from "../../db/schema";
import { generateId } from "../../db/schema/utils";
import { createLogger } from "../../lib/logger";
import { describeErrorWithCause } from "../../utils/error-cause";
import { getDeploymentLogPath } from "../deployment/paths";
import { DomainError, notFound, preconditionFailed } from "../errors";
import { inspectSwarmService, updateSwarmServiceImage } from "./docker";
import { updateApplication } from "./service";

const log = createLogger("application-rollback");

/** Rollbacks skip the deploy worker, so their (short) log is written here. */
async function writeRollbackLog(logPath: string, lines: string[]): Promise<void> {
	try {
		await mkdir(dirname(logPath), { recursive: true });
		await writeFile(logPath, `${lines.join("\n")}\n`, "utf8");
	} catch (error) {
		log.error(`Failed to write rollback log ${logPath}`, {
			error: describeErrorWithCause(error),
		});
	}
}

export interface ApplicationRollbackInput {
	application: { applicationId: string; appName: string; serverId: string | null };
	rollbackId: string;
	/** User id for the deployment row; null when nobody in particular did it. */
	triggeredBy: string | null;
}

export interface ApplicationRollbackResult {
	rollback: typeof rollbacks.$inferSelect;
	deployment: typeof deployments.$inferSelect;
}

/**
 * Point the running Swarm service at a pinned image again. The one place
 * that does it — `application.rollback` and an applied remediation proposal
 * both come here — so the deployment row, its log and the status flip stay
 * identical whoever pressed the button.
 */
export async function performApplicationRollback(
	input: ApplicationRollbackInput,
): Promise<ApplicationRollbackResult> {
	const { application } = input;
	const rollback = await db.query.rollbacks.findFirst({
		where: and(
			eq(rollbacks.rollbackId, input.rollbackId),
			eq(rollbacks.applicationId, application.applicationId),
		),
	});
	if (!rollback) throw notFound("Rollback not found");
	if (!(await inspectSwarmService(application.appName))) {
		throw preconditionFailed("Application has no running service to roll back — deploy it first");
	}

	const deploymentId = generateId();
	const logPath = getDeploymentLogPath(application.appName, deploymentId);
	const startedAt = new Date();
	const lines = [`Rollback ${deploymentId} started`, `Rolling back to image ${rollback.image}`];
	try {
		await updateSwarmServiceImage(application.appName, rollback.image);
		lines.push("Swarm service updated", "Rollback successful");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		lines.push(`Rollback failed: ${message}`);
		await writeRollbackLog(logPath, lines);
		await db.insert(deployments).values({
			deploymentId,
			title: "Rollback",
			description: `Rollback to ${rollback.image}`,
			status: "error",
			errorMessage: message,
			logPath,
			applicationId: application.applicationId,
			serverId: application.serverId,
			startedAt,
			finishedAt: new Date(),
			trigger: "rollback",
			triggeredBy: input.triggeredBy,
			commitSha: null,
			commitMessage: rollback.image,
		});
		throw new DomainError("INTERNAL_SERVER_ERROR", `Rollback failed: ${message}`, {
			cause: error,
		});
	}
	await writeRollbackLog(logPath, lines);

	const [deployment] = await db
		.insert(deployments)
		.values({
			deploymentId,
			title: "Rollback",
			description: `Rolled back to ${rollback.image}`,
			status: "done",
			logPath,
			applicationId: application.applicationId,
			serverId: application.serverId,
			startedAt,
			finishedAt: new Date(),
			trigger: "rollback",
			triggeredBy: input.triggeredBy,
			// No commit: the pinned image reference stands in for it.
			commitMessage: rollback.image,
		})
		.returning();
	if (!deployment) throw new DomainError("INTERNAL_SERVER_ERROR", "Failed to record the rollback");
	await updateApplication(application.applicationId, { status: "running" });
	return { rollback, deployment };
}
