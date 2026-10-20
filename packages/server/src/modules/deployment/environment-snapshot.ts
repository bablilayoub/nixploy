import { eq } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import { applications, compose } from "../../db/schema";
import { deploymentEnvironmentSnapshots } from "../../db/schema/configuration-release";
import { configurationFingerprint } from "../configuration-release/fingerprint";
import { notFound } from "../errors";
import {
	loadEnvironmentLayers,
	resolveEnvironmentLayers,
	toEnvString,
} from "../projects/env-resolution";

export type DeploymentEnvironmentSnapshot = typeof deploymentEnvironmentSnapshots.$inferSelect;

export async function captureDeploymentEnvironment(
	target: { applicationId?: string; composeId?: string },
	executor: DbExecutor = db,
): Promise<Omit<DeploymentEnvironmentSnapshot, "deploymentId" | "createdAt" | "releaseId">> {
	const row = target.applicationId
		? await executor.query.applications.findFirst({
				where: eq(applications.applicationId, target.applicationId),
			})
		: await executor.query.compose.findFirst({
				where: eq(compose.composeId, target.composeId ?? ""),
			});
	if (!row) throw notFound("Deployment service not found");
	const layers = await loadEnvironmentLayers(row.environmentId, executor);
	const serviceEnv = row.env ?? "";
	const buildArgs = "buildArgs" in row ? row.buildArgs : null;
	return {
		runtimeEnv: toEnvString(resolveEnvironmentLayers(layers, serviceEnv).values),
		serviceEnv,
		buildArgs,
		sourceFingerprint: configurationFingerprint({
			target: target.applicationId
				? { applicationId: target.applicationId }
				: { composeId: target.composeId },
			environmentId: row.environmentId,
			layers,
			serviceEnv,
			buildArgs,
		}),
	};
}

export async function recordDeploymentEnvironment(
	deploymentId: string,
	input: Awaited<ReturnType<typeof captureDeploymentEnvironment>>,
	options: { executor?: DbExecutor; releaseId?: string } = {},
): Promise<void> {
	await (options.executor ?? db).insert(deploymentEnvironmentSnapshots).values({
		deploymentId,
		...input,
		releaseId: options.releaseId ?? null,
	});
}

export async function findDeploymentEnvironment(
	deploymentId: string,
	executor: DbExecutor = db,
): Promise<DeploymentEnvironmentSnapshot | null> {
	const [snapshot] = await executor
		.select()
		.from(deploymentEnvironmentSnapshots)
		.where(eq(deploymentEnvironmentSnapshots.deploymentId, deploymentId));
	return snapshot ?? null;
}

/** Shared by manual and incident rollbacks; never absorb shared vars into service drafts. */
export function environmentForComposeRollback(
	snapshot: { deploymentId: string; mergedEnv: string | null; serviceEnv: string | null },
	current: Awaited<ReturnType<typeof captureDeploymentEnvironment>>,
	historical: DeploymentEnvironmentSnapshot | null,
): Awaited<ReturnType<typeof captureDeploymentEnvironment>> {
	const runtimeEnv = snapshot.mergedEnv ?? current.runtimeEnv;
	const serviceEnv = snapshot.serviceEnv ?? "";
	const buildArgs = historical ? historical.buildArgs : current.buildArgs;
	return {
		runtimeEnv,
		serviceEnv,
		buildArgs,
		sourceFingerprint: configurationFingerprint({
			rollbackOf: snapshot.deploymentId,
			runtimeEnv,
			serviceEnv,
			buildArgs,
		}),
	};
}
