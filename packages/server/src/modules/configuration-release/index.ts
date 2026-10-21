import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type DbExecutor, db, runWithDatabaseTransaction } from "../../db";
import { applications, compose, deployments, environments, projects } from "../../db/schema";
import { deploymentEnvironmentSnapshots } from "../../db/schema/configuration-release";
import { generateId } from "../../db/schema/utils";
import {
	publishQueuedDeployments,
	type QueuedDeploymentNotice,
	queueDeployment,
} from "../deployment";
import { captureDeploymentEnvironment } from "../deployment/environment-snapshot";
import { applicationReadiness, composeReadiness } from "../deployment/provenance";
import { badRequest, conflict, notFound } from "../errors";
import {
	assertCapability,
	assertProjectVisible,
	findEnvironmentById,
	findProjectById,
	hasCapability,
	projectIdFilter,
	resolveProjectFilter,
	runWithProjectFilter,
} from "../projects";
import {
	loadEnvironmentLayers,
	parseEnv,
	resolveEnvironmentLayers,
} from "../projects/env-resolution";
import { configurationFingerprint, matchesConfigurationReview } from "./fingerprint";

export const configurationScopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("organization") }),
	z.object({ kind: z.literal("project"), id: z.string().min(1) }),
	z.object({ kind: z.literal("environment"), id: z.string().min(1) }),
	z.object({ kind: z.literal("application"), id: z.string().min(1) }),
	z.object({ kind: z.literal("compose"), id: z.string().min(1) }),
]);
export type ConfigurationScope = z.infer<typeof configurationScopeSchema>;
export const configurationTargetSchema = z.object({
	kind: z.enum(["application", "compose"]),
	id: z.string().min(1),
});
export type ConfigurationTarget = z.infer<typeof configurationTargetSchema>;
const targetKey = (target: ConfigurationTarget): string => `${target.kind}:${target.id}`;

/** No values or value digests leave the server, including for secret readers. */
export function changedVariables(previous: Record<string, string>, next: Record<string, string>) {
	return [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort().flatMap((key) => {
		if (previous[key] === next[key] && Object.hasOwn(previous, key) === Object.hasOwn(next, key))
			return [];
		return [
			{
				key,
				change: !Object.hasOwn(next, key)
					? ("removed" as const)
					: !Object.hasOwn(previous, key)
						? ("added" as const)
						: ("changed" as const),
			},
		];
	});
}

async function targetsInScope(
	scope: ConfigurationScope,
	organizationId: string,
	executor: DbExecutor,
) {
	if (scope.kind === "project") await findProjectById(scope.id, organizationId);
	if (scope.kind === "environment") await findEnvironmentById(scope.id, organizationId);
	const filters = [
		eq(projects.organizationId, organizationId),
		projectIdFilter(projects.projectId),
	];
	if (scope.kind === "project") filters.push(eq(projects.projectId, scope.id));
	if (scope.kind === "environment") filters.push(eq(environments.environmentId, scope.id));
	const [appRows, composeRows] = await Promise.all([
		scope.kind === "compose"
			? []
			: executor
					.select({ row: applications, projectId: projects.projectId })
					.from(applications)
					.innerJoin(environments, eq(applications.environmentId, environments.environmentId))
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(
						and(
							...filters,
							...(scope.kind === "application" ? [eq(applications.applicationId, scope.id)] : []),
						),
					)
					.orderBy(asc(applications.applicationId))
					.limit(501),
		scope.kind === "application"
			? []
			: executor
					.select({ row: compose, projectId: projects.projectId })
					.from(compose)
					.innerJoin(environments, eq(compose.environmentId, environments.environmentId))
					.innerJoin(projects, eq(environments.projectId, projects.projectId))
					.where(
						and(...filters, ...(scope.kind === "compose" ? [eq(compose.composeId, scope.id)] : [])),
					)
					.orderBy(asc(compose.composeId))
					.limit(501),
	]);
	if (appRows.length + composeRows.length > 500)
		throw badRequest(
			"Review a project or environment with at most 500 applications and Compose stacks",
		);
	if (
		(scope.kind === "application" && !appRows.length) ||
		(scope.kind === "compose" && !composeRows.length)
	)
		throw notFound("Service not found");
	return [
		...appRows.map(({ row, projectId }) => ({
			kind: "application" as const,
			id: row.applicationId,
			row,
			projectId,
		})),
		...composeRows.map(({ row, projectId }) => ({
			kind: "compose" as const,
			id: row.composeId,
			row,
			projectId,
		})),
	].sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
}

export async function reviewConfiguration(
	scope: ConfigurationScope,
	organizationId: string,
	userId: string,
	executor: DbExecutor = db,
) {
	const targets = await targetsInScope(scope, organizationId, executor);
	const canRead = await hasCapability(userId, organizationId, "secrets.read");
	const plans = await Promise.all(
		targets.map(async (target) => {
			assertProjectVisible(target.projectId, "Service");
			const snapshot = await captureDeploymentEnvironment(
				target.kind === "application" ? { applicationId: target.id } : { composeId: target.id },
				executor,
			);
			const [previous] = await executor
				.select({
					runtimeEnv: deploymentEnvironmentSnapshots.runtimeEnv,
					buildArgs: deploymentEnvironmentSnapshots.buildArgs,
					deploymentId: deployments.deploymentId,
				})
				.from(deployments)
				.innerJoin(
					deploymentEnvironmentSnapshots,
					eq(deployments.deploymentId, deploymentEnvironmentSnapshots.deploymentId),
				)
				.where(
					and(
						eq(deployments.status, "done"),
						eq(deployments.isPreview, false),
						target.kind === "application"
							? eq(deployments.applicationId, target.id)
							: eq(deployments.composeId, target.id),
					),
				)
				.orderBy(desc(deployments.createdAt), desc(deployments.deploymentId))
				.limit(1);
			const changes = changedVariables(
				parseEnv(previous?.runtimeEnv),
				parseEnv(snapshot.runtimeEnv),
			);
			const buildChanges = changedVariables(
				parseEnv(previous?.buildArgs),
				parseEnv(snapshot.buildArgs),
			);
			const readiness = await (target.kind === "application"
				? applicationReadiness(target.row as typeof applications.$inferSelect)
				: composeReadiness(target.row as typeof compose.$inferSelect));
			const layers = await loadEnvironmentLayers(target.row.environmentId, executor);
			const effective = resolveEnvironmentLayers(layers, snapshot.serviceEnv);
			return {
				target,
				snapshot,
				previousId: previous?.deploymentId ?? null,
				review: {
					kind: target.kind,
					id: target.id,
					name: target.row.name,
					appName: target.row.appName,
					environmentId: target.row.environmentId,
					projectId: target.projectId,
					baseline: previous ? ("last-successful" as const) : ("unknown" as const),
					pending: !previous || changes.length > 0 || buildChanges.length > 0,
					changes: canRead
						? changes.map((change) => ({
								...change,
								origin: effective.origins[change.key] ?? null,
							}))
						: null,
					variableChanges: changes.length,
					buildArgumentChanges: buildChanges.length,
					buildChanges: canRead ? buildChanges : null,
					canDeploy: readiness.canDeploy,
					reason: readiness.reason,
				},
			};
		}),
	);
	const token = configurationFingerprint({
		scope,
		organizationId,
		userId,
		plans: plans.map(({ target, snapshot, previousId }) => ({
			target: targetKey(target),
			projectId: target.projectId,
			source: target.row,
			snapshot,
			previousId,
		})),
	});
	return {
		token,
		scope,
		redacted: !canRead,
		targets: plans.map((plan) => plan.review),
		excluded:
			"Managed databases and previews are excluded. Database-generated credentials stay in their service settings.",
	};
}

/** Short database-only transaction: no Docker, network, or file effects before commit. */
export async function applyConfiguration(
	input: { scope: ConfigurationScope; reviewToken: string; targets: ConfigurationTarget[] },
	organizationId: string,
	userId: string,
) {
	const notices: QueuedDeploymentNotice[] = [];
	const releaseId = generateId();
	const result = await db.transaction(async (tx) =>
		runWithDatabaseTransaction(tx, async () => {
			// Keep revocation stable through commit. Existing membership/team grants cannot
			// disappear while the authorization and scoped plan are checked again.
			await tx.execute(
				sql`select id from member where user_id=${userId} and organization_id=${organizationId} for update`,
			);
			await tx.execute(
				sql`select tm.team_id from team_member tm inner join team t on t.team_id=tm.team_id where tm.user_id=${userId} and t.organization_id=${organizationId} for share of tm,t`,
			);
			await tx.execute(
				sql`select tp.team_id from team_project tp inner join team t on t.team_id=tp.team_id where t.organization_id=${organizationId} for share of tp`,
			);
			const filter = await resolveProjectFilter(userId);
			return await runWithProjectFilter(filter, async () => {
				await assertCapability(userId, organizationId, "secrets.write");
				await assertCapability(userId, organizationId, "service.deploy");
				await tx.execute(sql`select id from organization where id=${organizationId} for update`);
				const targets = await targetsInScope(input.scope, organizationId, tx);
				const projectIds = [...new Set(targets.map((target) => target.projectId))].sort();
				if (projectIds.length)
					await tx
						.select({ id: projects.projectId })
						.from(projects)
						.where(inArray(projects.projectId, projectIds))
						.orderBy(asc(projects.projectId))
						.for("update");
				const environmentIds = [
					...new Set(targets.map((target) => target.row.environmentId)),
				].sort();
				if (environmentIds.length)
					await tx
						.select({ id: environments.environmentId })
						.from(environments)
						.where(inArray(environments.environmentId, environmentIds))
						.orderBy(asc(environments.environmentId))
						.for("update");
				for (const target of targets) {
					if (target.kind === "application")
						await tx
							.select({ id: applications.applicationId })
							.from(applications)
							.where(eq(applications.applicationId, target.id))
							.for("update");
					else
						await tx
							.select({ id: compose.composeId })
							.from(compose)
							.where(eq(compose.composeId, target.id))
							.for("update");
				}
				const review = await reviewConfiguration(input.scope, organizationId, userId, tx);
				if (!matchesConfigurationReview(review.token, input.reviewToken))
					throw conflict(
						"Configuration or access changed since review. Review the latest changes before deploying.",
					);
				const selected = new Set(input.targets.map(targetKey));
				if (!selected.size || selected.size !== input.targets.length)
					throw badRequest("Select at least one service without duplicates");
				const allowed = new Map(review.targets.map((target) => [targetKey(target), target]));
				const deploymentsQueued: Array<ConfigurationTarget & { deploymentId: string }> = [];
				for (const key of [...selected].sort()) {
					const target = allowed.get(key);
					if (!target) throw notFound("Selected service not found in this review");
					if (!target.canDeploy)
						throw badRequest(target.reason ?? "Selected service is not ready to deploy");
					const deploymentId = await queueDeployment(
						{
							...(target.kind === "application"
								? { applicationId: target.id }
								: { composeId: target.id }),
							type: "redeploy",
							title: "Configuration release",
							trigger: "manual",
							triggeredBy: userId,
						},
						{ executor: tx, notices, releaseId },
					);
					deploymentsQueued.push({ kind: target.kind, id: target.id, deploymentId });
				}
				return { releaseId, deployments: deploymentsQueued };
			});
		}),
	);
	await publishQueuedDeployments(notices);
	return result;
}
