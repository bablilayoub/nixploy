import { and, eq, inArray, ne, or } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import { environments, postgres, projects, recoveryCopies } from "../../db/schema";
import { preconditionFailed } from "../errors";

type TeardownScope = { environmentId: string } | { projectId: string } | { organizationId: string };

/** Reject a generic delete before it cancels schedules or changes infrastructure. */
export async function assertUntrackedRecoveryTarget(
	appName: string,
	postgresId?: string,
): Promise<void> {
	const copy = await db.query.recoveryCopies.findFirst({
		where: and(
			ne(recoveryCopies.status, "deleted"),
			or(
				eq(recoveryCopies.originAppName, appName),
				postgresId ? eq(recoveryCopies.targetPostgresId, postgresId) : undefined,
			),
		),
		columns: { recoveryCopyId: true },
	});
	if (copy)
		throw preconditionFailed(
			"Use Delete copy in Backups or the project's Recovery copies tab to remove this tracked database",
		);
}

/** Refuse bulk teardown before any side effects, including moved or missing targets. */
export async function assertRecoveryCopiesDeleted(
	scope: TeardownScope,
	executor: DbExecutor = db,
): Promise<void> {
	const environmentAxis =
		"environmentId" in scope
			? eq(environments.environmentId, scope.environmentId)
			: "projectId" in scope
				? eq(environments.projectId, scope.projectId)
				: eq(projects.organizationId, scope.organizationId);
	const affectedEnvironments = executor
		.select({ id: environments.environmentId })
		.from(environments)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(environmentAxis);
	const affectedTargets = executor
		.select({ id: postgres.postgresId })
		.from(postgres)
		.where(inArray(postgres.environmentId, affectedEnvironments));
	const copy = await executor.query.recoveryCopies.findFirst({
		where: and(
			ne(recoveryCopies.status, "deleted"),
			or(
				inArray(recoveryCopies.environmentId, affectedEnvironments),
				inArray(recoveryCopies.targetPostgresId, affectedTargets),
				"organizationId" in scope
					? eq(recoveryCopies.organizationId, scope.organizationId)
					: undefined,
			),
		),
		columns: { recoveryCopyId: true },
	});
	if (copy) {
		throw preconditionFailed(
			"Delete retained copies from the project's Recovery copies tab first. A copy with an unknown storage location requires manual inspection before its tracking can be removed.",
		);
	}
}
