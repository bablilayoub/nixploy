import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, domains, previewDeployments } from "../../db/schema";
import { removeApplicationImages, removeSwarmService } from "../application/docker";
import { getWildcardDomain } from "../application/paths";
import { queueDeployment } from "../deployment";
import { removeTraefikConfig } from "../traefik";
import { syncPreviewTraefik } from "./traefik";

export {
	encodePreviewSourceRef,
	isMetadataOnlyPullRequestUpdate,
	type PreviewSourceRef,
	parsePreviewSourceRef,
	previewSourceRefForPullRequest,
	pullRequestHeadRef,
} from "./source-ref";
export { syncPreviewTraefik } from "./traefik";

export type CreatePreviewInput = {
	applicationId: string;
	pullRequestNumber: string;
	/**
	 * Source to build: a branch name, a provider PR ref (`refs/pull/<n>/head`)
	 * or a Bitbucket fork spec — see `source-ref.ts`.
	 */
	branch?: string | null;
	pullRequestId?: string | null;
	pullRequestTitle?: string | null;
	pullRequestURL?: string | null;
	pullRequestAuthor?: string | null;
	expiresAt?: Date | null;
	/**
	 * Fork-gated PRs: create the preview row + route but do NOT build.
	 * The row lands in `awaiting_approval` until previewDeployment.approve.
	 */
	deferDeploy?: boolean;
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
	assertNumericPullRequest(pullRequestNumber);
	return `${appName}-pr-${pullRequestNumber}`;
}

/** Wildcard host for a PR preview: `pr-<n>-<appName>.<wildcardDomain>`. */
export function previewHost(appName: string, pullRequestNumber: string): string {
	assertNumericPullRequest(pullRequestNumber);
	return `pr-${pullRequestNumber}-${appName}.${getWildcardDomain()}`;
}

function assertNumericPullRequest(pullRequestNumber: string): void {
	if (!/^\d{1,10}$/.test(pullRequestNumber)) {
		throw new Error(`Invalid pull request number: ${pullRequestNumber}`);
	}
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
 * config, and enqueue a deploy of the isolated preview service (not production).
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
	// The parent's first production domain tells us the container port the
	// app listens on and which TLS settings to mirror.
	const parentDomain = await db.query.domains.findFirst({
		where: and(
			eq(domains.applicationId, application.applicationId),
			eq(domains.domainType, "application"),
		),
	});
	const https = Boolean(parentDomain?.https);
	const certificateType = https
		? (parentDomain?.certificateType ?? "letsencrypt")
		: ("none" as const);

	const [preview] = await db
		.insert(previewDeployments)
		.values({
			appName: variantAppName,
			branch: input.branch ?? application.branch ?? application.gitBranch,
			pullRequestId: input.pullRequestId ?? null,
			pullRequestNumber: input.pullRequestNumber,
			pullRequestTitle: input.pullRequestTitle ?? null,
			pullRequestURL: input.pullRequestURL ?? null,
			pullRequestAuthor: input.pullRequestAuthor ?? null,
			previewStatus: input.deferDeploy ? "awaiting_approval" : "running",
			expiresAt: input.expiresAt ?? null,
			applicationId: application.applicationId,
			serverId: application.serverId,
		})
		.returning();
	if (!preview) {
		throw new Error("Failed to create preview deployment");
	}

	// Compensation on any failure below: without it the preview row survives
	// and every subsequent webhook for this PR hits PreviewConflictError.
	try {
		const [domain] = await db
			.insert(domains)
			.values({
				host,
				path: "/",
				// Same container port as production: a static build serves on
				// nginx:80, a Go app on 8080 — hardcoding 3000 502'd all of them.
				port: parentDomain?.port ?? null,
				https,
				certificateType,
				certificateId: https ? (parentDomain?.certificateId ?? null) : null,
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

		// Route + the parent's basic-auth/redirects (the preview runs the
		// parent's production env, so it must not be reachable without auth).
		await syncPreviewTraefik(preview.previewDeploymentId);

		if (input.deferDeploy) {
			// Awaiting approval: route exists but nothing was built. Approving
			// redeploys via redeployPreviewDeployment.
			return { ...preview, domainId: domain?.domainId ?? null, domain: domain ?? null };
		}

		const deploymentId = await queueDeployment({
			applicationId: application.applicationId,
			previewDeploymentId: preview.previewDeploymentId,
			type: "deploy",
		});

		return {
			...preview,
			domainId: domain?.domainId ?? null,
			domain: domain ?? null,
			deploymentId,
		};
	} catch (error) {
		await removeTraefikConfig(variantAppName).catch(() => {});
		await db
			.delete(domains)
			.where(eq(domains.previewDeploymentId, preview.previewDeploymentId))
			.catch(() => {});
		await db
			.delete(previewDeployments)
			.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId))
			.catch(() => {});
		throw error;
	}
}

/** Redeploy an existing preview by enqueueing an isolated preview deploy. */
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
		previewDeploymentId: preview.previewDeploymentId,
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
		if (
			input.branch ||
			input.pullRequestTitle ||
			input.pullRequestURL ||
			input.pullRequestId ||
			input.pullRequestAuthor
		) {
			await db
				.update(previewDeployments)
				.set({
					...(input.branch !== undefined ? { branch: input.branch } : {}),
					...(input.pullRequestTitle !== undefined
						? { pullRequestTitle: input.pullRequestTitle }
						: {}),
					...(input.pullRequestURL !== undefined ? { pullRequestURL: input.pullRequestURL } : {}),
					...(input.pullRequestId !== undefined ? { pullRequestId: input.pullRequestId } : {}),
					...(input.pullRequestAuthor !== undefined
						? { pullRequestAuthor: input.pullRequestAuthor }
						: {}),
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
	// The PR build is tagged `<app>-pr-<n>:latest`; nothing else references it.
	await removeApplicationImages(preview.appName, serverId).catch(() => {});
	// Routing YAML always lives on the Nixploy host (where Traefik runs).
	await removeTraefikConfig(preview.appName);
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
