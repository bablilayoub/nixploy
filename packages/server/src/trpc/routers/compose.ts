import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { compose, environments, projects } from "../../db/schema";
import { assertEnvironmentAccess } from "../../modules/application";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import { ComposeValidationError } from "../../modules/compose/compose-file";
import { listComposeContainers } from "../../modules/compose/containers";
import {
	createCompose,
	deleteCompose,
	duplicateCompose,
	findComposeForOrg,
	loadServices,
	saveComposeFile,
	saveEnvironment,
	startCompose,
	stopCompose,
	updateComposeById,
} from "../../modules/compose/service";
import { composeReadiness, provenanceForSession, queueDeployment } from "../../modules/deployment";
import {
	assertCapability,
	assertWithinQuota,
	hasCapability,
	resolveCallerOrganizationId,
} from "../../modules/projects";
import { textBlobSchema, watchPathsSchema } from "../../utils/input-limits";
import { assertSafeGitCloneUrl } from "../../utils/public-url";
import { appNameSchema } from "../../utils/validators";
import {
	assertGitProviderInOrganization,
	assertServerInOrganization,
	assertSshKeyInOrganization,
} from "../assert-org-refs";
import type { TRPCContext } from "../init";
import { protectedProcedure, router } from "../init";
import { redactComposeSecrets } from "../redact-secrets";

/** Pre-flight (UX audit F2): refuse before a row is queued when there is nothing to deploy. */
function assertComposeDeployable(row: Parameters<typeof composeReadiness>[0]): void {
	const readiness = composeReadiness(row);
	if (!readiness.canDeploy) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: readiness.reason ?? "Compose source is not configured",
		});
	}
}

type Session = NonNullable<TRPCContext["session"]>;

async function getOrganizationId(session: Session): Promise<string> {
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const composeIdInput = z.object({ composeId: z.string().min(1) });

export const composeRouter = router({
	/** Compose services of a project (optionally one environment). */
	all: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				environmentName: z.string().optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			const project = await db.query.projects.findFirst({
				where: eq(projects.projectId, input.projectId),
			});
			if (!project || project.organizationId !== organizationId) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
			}
			const envs = await db.query.environments.findMany({
				where: input.environmentName
					? and(
							eq(environments.projectId, input.projectId),
							eq(environments.name, input.environmentName),
						)
					: eq(environments.projectId, input.projectId),
			});
			if (envs.length === 0) return [];
			const rows = await db.query.compose.findMany({
				where: inArray(
					compose.environmentId,
					envs.map((e) => e.environmentId),
				),
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			if (canSeeSecrets) return rows;
			return rows.map(redactComposeSecrets);
		}),

	/** A single compose service by id. */
	one: protectedProcedure.input(composeIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findComposeForOrg(input.composeId, organizationId);
		const canSeeSecrets = await hasCapability(ctx.session.user.id, organizationId, "secrets.read");
		// Same predicate `deploy` enforces — lets the UI disable Deploy with the reason.
		const safe = { ...row, readiness: composeReadiness(row) };
		if (canSeeSecrets) return safe;
		return redactComposeSecrets(safe);
	}),

	/** Create a compose service (raw paste or git-backed source). */
	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				description: z.string().nullish(),
				environmentId: z.string().min(1),
				composeType: z.enum(["docker-compose", "stack"]),
				sourceType: z.enum(["raw", "git", "github", "gitlab", "bitbucket", "gitea"]),
				appName: appNameSchema.optional(),
				serverId: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.create");
			await assertWithinQuota(organizationId, { services: true });
			await assertEnvironmentAccess(input.environmentId, organizationId);
			await assertServerInOrganization(input.serverId, organizationId);
			const created = await createCompose({
				name: input.name,
				description: input.description ?? null,
				environmentId: input.environmentId,
				composeType: input.composeType,
				sourceType: input.sourceType,
				appName: input.appName,
				serverId: input.serverId ?? null,
			});
			await auditFromSession(ctx, organizationId, {
				action: "compose.create",
				targetType: "compose",
				targetId: created.composeId,
				targetName: created.name,
			});
			return created;
		}),

	/** Update settings/source of a compose service. */
	update: protectedProcedure
		.input(
			composeIdInput.extend({
				name: z.string().min(1).optional(),
				description: z.string().nullish(),
				appName: appNameSchema.optional(),
				composeType: z.enum(["docker-compose", "stack"]).optional(),
				sourceType: z.enum(["raw", "git", "github", "gitlab", "bitbucket", "gitea"]).optional(),
				repository: z.string().nullish(),
				owner: z.string().nullish(),
				branch: z.string().nullish(),
				composePath: z.string().min(1).optional(),
				autoDeploy: z.boolean().optional(),
				watchPaths: watchPathsSchema.nullish(),
				gitUrl: z.string().nullish(),
				gitBranch: z.string().nullish(),
				customGitSSHKeyId: z.string().nullish(),
				githubId: z.string().nullish(),
				gitlabId: z.string().nullish(),
				bitbucketId: z.string().nullish(),
				giteaId: z.string().nullish(),
				isolatedDeployment: z.boolean().optional(),
				// Shell commands run in a container of the project around the
				// rollout; capped like every other tenant text blob.
				preDeployCommand: textBlobSchema.nullish(),
				postDeployCommand: textBlobSchema.nullish(),
				/** Generated server-side when isolation is enabled without one. */
				suffix: z
					.string()
					.regex(/^[a-z0-9-]{0,16}$/, "suffix must be lowercase a-z0-9- (max 16 chars)")
					.optional(),
				serverId: z.string().nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const row = await findComposeForOrg(input.composeId, organizationId);
			// Host-privileged rows (docker.sock templates) relax the compose safety
			// check on every deploy. Re-pointing their source at another repo or
			// path would render an attacker's file with that relaxation, so the
			// row is instance-admin only — same gate as `saveComposeFile`.
			let callerIsInstanceAdmin = false;
			if (row.hostPrivileged) {
				await assertInstanceAdmin(ctx.session);
				callerIsInstanceAdmin = true;
			}

			if (input.gitUrl) {
				try {
					await assertSafeGitCloneUrl(input.gitUrl);
				} catch (error) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: error instanceof Error ? error.message : "Invalid git URL",
					});
				}
			}

			if (input.preDeployCommand !== undefined || input.postDeployCommand !== undefined) {
				// Hook commands are shell and are redacted like other secrets.
				await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			}

			await assertServerInOrganization(input.serverId, organizationId);
			await assertSshKeyInOrganization(input.customGitSSHKeyId, organizationId);
			for (const provider of ["github", "gitlab", "bitbucket", "gitea"] as const) {
				const providerId = input[`${provider}Id`];
				if (providerId) {
					await assertGitProviderInOrganization(provider, providerId, organizationId);
				}
			}

			const { composeId, ...values } = input;
			if (Object.values(values).every((value) => value === undefined)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Nothing to update — pass at least one field",
				});
			}
			const updated = await updateComposeById(composeId, values, { callerIsInstanceAdmin });
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? updated : redactComposeSecrets(updated);
		}),

	/**
	 * Tear down the deployment, remove Traefik configs and delete the row.
	 * Docker failures are tolerated so a broken deployment never blocks this.
	 */
	/**
	 * Clone this compose service (compose file, env, source, mounts) into the
	 * same or a different environment; domains and deployments are not copied.
	 */
	duplicate: protectedProcedure
		.input(composeIdInput.extend({ environmentId: z.string().optional() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			const row = await findComposeForOrg(input.composeId, organizationId);
			const targetEnvironmentId = input.environmentId ?? row.environmentId;
			if (targetEnvironmentId !== row.environmentId) {
				await assertEnvironmentAccess(targetEnvironmentId, organizationId);
			}
			const created = await duplicateCompose(row, targetEnvironmentId);
			await auditFromSession(ctx, organizationId, {
				action: "compose.duplicate",
				targetType: "compose",
				targetId: created.composeId,
				targetName: created.name,
				metadata: { sourceId: input.composeId },
			});
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? created : redactComposeSecrets(created);
		}),

	/** Move this compose service to another environment (any project in the org). */
	move: protectedProcedure
		.input(composeIdInput.extend({ environmentId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const row = await findComposeForOrg(input.composeId, organizationId);
			await assertEnvironmentAccess(input.environmentId, organizationId);
			const [updated] = await db
				.update(compose)
				.set({ environmentId: input.environmentId })
				.where(eq(compose.composeId, input.composeId))
				.returning();
			await auditFromSession(ctx, organizationId, {
				action: "compose.move",
				targetType: "compose",
				targetId: input.composeId,
				targetName: row.name,
				metadata: { environmentId: input.environmentId },
			});
			if (!updated) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Compose not found" });
			}
			const canSeeSecrets = await hasCapability(
				ctx.session.user.id,
				organizationId,
				"secrets.read",
			);
			return canSeeSecrets ? updated : redactComposeSecrets(updated);
		}),

	delete: protectedProcedure.input(composeIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.delete");
		const row = await findComposeForOrg(input.composeId, organizationId);
		await deleteCompose(row);
		await auditFromSession(ctx, organizationId, {
			action: "compose.delete",
			targetType: "compose",
			targetId: input.composeId,
			targetName: row.name,
		});
		return true;
	}),

	/** Enqueue a deployment (clone/pull + `compose up` / `stack deploy`). */
	deploy: protectedProcedure.input(composeIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
		const row = await findComposeForOrg(input.composeId, organizationId);
		assertComposeDeployable(row);
		const deploymentId = await queueDeployment({
			composeId: input.composeId,
			type: "deploy",
			...provenanceForSession(ctx.session),
		});
		await auditFromSession(ctx, organizationId, {
			action: "compose.deploy",
			targetType: "compose",
			targetId: input.composeId,
			metadata: { deploymentId },
		});
		return { deploymentId };
	}),

	/** Enqueue a redeployment of the current source. */
	redeploy: protectedProcedure.input(composeIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.deploy");
		const row = await findComposeForOrg(input.composeId, organizationId);
		assertComposeDeployable(row);
		const deploymentId = await queueDeployment({
			composeId: input.composeId,
			type: "redeploy",
			...provenanceForSession(ctx.session),
		});
		return { deploymentId };
	}),

	/** Start a stopped deployment (`compose up -d` / `stack deploy`). */
	start: protectedProcedure.input(composeIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
		const row = await findComposeForOrg(input.composeId, organizationId);
		await startCompose(row);
		return true;
	}),

	/** Stop the deployment (`compose stop` / `stack rm`), keeping the row. */
	stop: protectedProcedure.input(composeIdInput).mutation(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		await assertCapability(ctx.session.user.id, organizationId, "service.runtime");
		const row = await findComposeForOrg(input.composeId, organizationId);
		await stopCompose(row);
		return true;
	}),

	/** Save the service-level `.env` content (encrypted at rest). */
	saveEnvironment: protectedProcedure
		.input(composeIdInput.extend({ env: textBlobSchema }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "secrets.write");
			await findComposeForOrg(input.composeId, organizationId);
			await saveEnvironment(input.composeId, input.env);
			return true;
		}),

	/**
	 * Save the compose file (validated before persisting). For raw sources
	 * this updates the row; for git sources it overwrites the local clone.
	 */
	saveComposeFile: protectedProcedure
		.input(composeIdInput.extend({ composeFile: textBlobSchema }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await getOrganizationId(ctx.session);
			await assertCapability(ctx.session.user.id, organizationId, "service.write");
			const row = await findComposeForOrg(input.composeId, organizationId);
			let callerIsInstanceAdmin = false;
			if (row.hostPrivileged) {
				await assertInstanceAdmin(ctx.session);
				callerIsInstanceAdmin = true;
			}
			try {
				await saveComposeFile(row, input.composeFile, { callerIsInstanceAdmin });
			} catch (error) {
				if (error instanceof ComposeValidationError) {
					throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
				}
				throw error;
			}
			return true;
		}),

	/** Service names defined by the compose file (for domain/log targeting). */
	loadServices: protectedProcedure.input(composeIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findComposeForOrg(input.composeId, organizationId);
		return await loadServices(row);
	}),

	/** Running containers for this compose project (for terminal/log targeting). */
	containers: protectedProcedure.input(composeIdInput).query(async ({ ctx, input }) => {
		const organizationId = await getOrganizationId(ctx.session);
		const row = await findComposeForOrg(input.composeId, organizationId);
		return await listComposeContainers(row.appName, row.serverId);
	}),
});
