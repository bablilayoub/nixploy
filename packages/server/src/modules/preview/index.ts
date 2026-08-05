import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, domains, previewDeployments } from "../../db/schema";
import { removeSwarmService } from "../application/docker";
import { getWildcardDomain } from "../application/paths";
import { queueDeployment } from "../deployment";
import { removeTraefikConfig, writeAppTraefikConfig } from "../traefik";

export type CreatePreviewInput = {
	applicationId: string;
	pullRequestNumber: string;
	branch?: string | null;
	pullRequestId?: string | null;
	pullRequestTitle?: string | null;
	pullRequestURL?: string | null;
	expiresAt?: Date | null;
};

export type PreviewWithDomain = typeof previewDeployments.$inferSelect & {
	domain: typeof domains.$inferSelect | null;
	deploymentId?: string;
};

export class PreviewConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PreviewConflictError";
	}
}

export class PreviewNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PreviewNotFoundError";
	}
}

/** Variant swarm/traefik name for a PR preview: `<appName>-pr-<n>`. */
export function previewAppName(appName: string, pullRequestNumber: string): string {
	return `${appName}-pr-${pullRequestNumber}`;
}

/** Wildcard host for a PR preview: `pr-<n>-<appName>.<wildcardDomain>`. */
export function previewHost(appName: string, pullRequestNumber: string): string {
	return `pr-${pullRequestNumber}-${appName}.${getWildcardDomain()}`;
}

/** Attach the preview's domain row (1:1) if present. */
export async function withPreviewDomain<T extends { previewDeploymentId: string }>(
	preview: T,
): Promise<T & { domain: typeof domains.$inferSelect | null }> {
	const domain = await db.query.domains.findFirst({
		where: eq(domains.previewDeploymentId, preview.previewDeploymentId),
	});
	return { ...preview, domain: domain ?? null };
}

/**
 * Spin up a per-PR variant: insert preview + domain rows, write Traefik
 * config, and enqueue a deploy of the parent application.
 */
export async function createPreviewDeployment(
	input: CreatePreviewInput,
): Promise<PreviewWithDomain> {
	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, input.applicationId),
	});
	if (!application) {
		throw new PreviewNotFoundError(`Application not found: ${input.applicationId}`);
	}

	const variantAppName = previewAppName(application.appName, input.pullRequestNumber);
	const existing = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.appName, variantAppName),
	});
	if (existing) {
		throw new PreviewConflictError(
			`A preview deployment for PR #${input.pullRequestNumber} already exists`,
		);
	}

	const host = previewHost(application.appName, input.pullRequestNumber);

	const [preview] = await db
		.insert(previewDeployments)
		.values({
			appName: variantAppName,
			branch: input.branch ?? application.branch ?? application.gitBranch,
			pullRequestId: input.pullRequestId ?? null,
			pullRequestNumber: input.pullRequestNumber,
			pullRequestTitle: input.pullRequestTitle ?? null,
			pullRequestURL: input.pullRequestURL ?? null,
			previewStatus: "running",
			expiresAt: input.expiresAt ?? null,
			applicationId: application.applicationId,
			serverId: application.serverId,
		})
		.returning();
	if (!preview) {
		throw new Error("Failed to create preview deployment");
	}

	const [domain] = await db
		.insert(domains)
		.values({
			host,
			path: "/",
			port: null,
			https: false,
			certificateType: "none",
			domainType: "preview",
			applicationId: application.applicationId,
			previewDeploymentId: preview.previewDeploymentId,
		})
		.returning();

	if (domain) {
		await db
			.update(previewDeployments)
			.set({ domainId: domain.domainId })
			.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));
	}

	await writeAppTraefikConfig({
		appName: variantAppName,
		serverId: application.serverId,
		domains: [
			{
				host,
				port: 3000,
				path: "/",
				https: false,
				certificateType: "none",
			},
		],
	});

	const deploymentId = await queueDeployment({
		applicationId: application.applicationId,
		type: "deploy",
	});

	return {
		...preview,
		domainId: domain?.domainId ?? null,
		domain: domain ?? null,
		deploymentId,
	};
}

/** Redeploy an existing preview by enqueueing a parent-app redeploy. */
export async function redeployPreviewDeployment(
	previewDeploymentId: string,
): Promise<{ previewDeploymentId: string; deploymentId: string }> {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) {
		throw new PreviewNotFoundError(`Preview deployment not found: ${previewDeploymentId}`);
	}

	await db
		.update(previewDeployments)
		.set({ previewStatus: "running" })
		.where(eq(previewDeployments.previewDeploymentId, previewDeploymentId));

	const deploymentId = await queueDeployment({
		applicationId: preview.applicationId,
		type: "redeploy",
	});

	return { previewDeploymentId: preview.previewDeploymentId, deploymentId };
}

/**
 * Find a preview by application + PR number, or null if none exists.
 */
export async function findPreviewByPullRequest(applicationId: string, pullRequestNumber: string) {
	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
	});
	if (!application) return null;
	const variantAppName = previewAppName(application.appName, pullRequestNumber);
	return await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.appName, variantAppName),
	});
}

/**
 * Create a preview if missing, otherwise redeploy the existing one.
 * Used by pull_request opened/synchronize/reopened webhooks.
 */
export async function createOrRedeployPreview(input: CreatePreviewInput): Promise<{
	action: "created" | "redeployed";
	previewDeploymentId: string;
	deploymentId: string;
}> {
	const existing = await findPreviewByPullRequest(input.applicationId, input.pullRequestNumber);
	if (existing) {
		if (input.branch || input.pullRequestTitle || input.pullRequestURL || input.pullRequestId) {
			await db
				.update(previewDeployments)
				.set({
					...(input.branch !== undefined ? { branch: input.branch } : {}),
					...(input.pullRequestTitle !== undefined
						? { pullRequestTitle: input.pullRequestTitle }
						: {}),
					...(input.pullRequestURL !== undefined ? { pullRequestURL: input.pullRequestURL } : {}),
					...(input.pullRequestId !== undefined ? { pullRequestId: input.pullRequestId } : {}),
				})
				.where(eq(previewDeployments.previewDeploymentId, existing.previewDeploymentId));
		}
		const result = await redeployPreviewDeployment(existing.previewDeploymentId);
		return {
			action: "redeployed",
			previewDeploymentId: result.previewDeploymentId,
			deploymentId: result.deploymentId,
		};
	}

	const created = await createPreviewDeployment(input);
	return {
		action: "created",
		previewDeploymentId: created.previewDeploymentId,
		deploymentId: created.deploymentId ?? "",
	};
}

/** Tear down a preview: swarm service, Traefik YAML, domain + preview rows. */
export async function deletePreviewDeployment(
	previewDeploymentId: string,
): Promise<{ previewDeploymentId: string }> {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) {
		throw new PreviewNotFoundError(`Preview deployment not found: ${previewDeploymentId}`);
	}

	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, preview.applicationId),
	});
	const serverId = application?.serverId ?? preview.serverId;

	await removeSwarmService(preview.appName, serverId).catch(() => {
		// variant may never have been deployed
	});
	await removeTraefikConfig(preview.appName, serverId);
	await db.delete(domains).where(eq(domains.previewDeploymentId, preview.previewDeploymentId));
	await db
		.delete(previewDeployments)
		.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));

	return { previewDeploymentId: preview.previewDeploymentId };
}

/**
 * Delete the preview for an application + PR number if it exists.
 * No-op when missing (idempotent webhook close).
 */
export async function deletePreviewByPullRequest(
	applicationId: string,
	pullRequestNumber: string,
): Promise<{ previewDeploymentId: string } | null> {
	const existing = await findPreviewByPullRequest(applicationId, pullRequestNumber);
	if (!existing) return null;
	return await deletePreviewDeployment(existing.previewDeploymentId);
}

/** Normalize provider PR actions into create/redeploy vs destroy. */
export function classifyPullRequestAction(action: string): "upsert" | "delete" | "ignore" {
	const normalized = action.toLowerCase();
	if (
		normalized === "opened" ||
		normalized === "open" ||
		normalized === "synchronize" ||
		normalized === "synchronized" ||
		normalized === "reopened" ||
		normalized === "reopen" ||
		normalized === "update" ||
		normalized === "updated" ||
		normalized === "created"
	) {
		return "upsert";
	}
	if (
		normalized === "closed" ||
		normalized === "close" ||
		normalized === "merge" ||
		normalized === "merged" ||
		normalized === "fulfilled" ||
		normalized === "rejected" ||
		normalized === "declined"
	) {
		return "delete";
	}
	return "ignore";
}
