import { and, count, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, domains, previewDeployments } from "../../db/schema";
import { removeApplicationImages, removeSwarmService } from "../application/docker";
import { getWildcardDomain } from "../application/paths";
import { queueDeployment } from "../deployment";
import { DomainError } from "../errors";
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
	/** Provenance of the queued deployment: `webhook:<provider>` or a user id. */
	triggeredBy?: string | null;
	/** PR head sha when the provider sent it (the clone fills the rest). */
	commitSha?: string | null;
	/** First line of the head commit message; only GitLab payloads carry one. */
	commitMessage?: string | null;
	commitAuthor?: string | null;
	/** Provider commit page for `commitSha`. */
	commitUrl?: string | null;
};

/** Head-commit metadata stored on the preview row and refreshed on every push. */
export type PreviewCommit = Pick<
	CreatePreviewInput,
	"commitSha" | "commitMessage" | "commitAuthor" | "commitUrl"
>;

/** Provenance a preview job carries (webhook delivery or approve/redeploy click). */
export type PreviewProvenance = Pick<CreatePreviewInput, "triggeredBy"> & PreviewCommit;

/**
 * Only overwrite a stored commit field when the new delivery actually has
 * one: a Bitbucket `pullrequest:updated` for a title edit must not blank the
 * message a previous delivery recorded.
 */
function commitColumns(input: PreviewCommit): Partial<PreviewCommit> {
	const patch: Partial<PreviewCommit> = {};
	if (input.commitSha) patch.commitSha = input.commitSha;
	if (input.commitMessage) patch.commitMessage = input.commitMessage;
	if (input.commitAuthor) patch.commitAuthor = input.commitAuthor;
	if (input.commitUrl) patch.commitUrl = input.commitUrl;
	return patch;
}

export type PreviewWithDomain = typeof previewDeployments.$inferSelect & {
	domain: typeof domains.$inferSelect | null;
	deploymentId?: string;
};

export class PreviewConflictError extends DomainError {
	constructor(message: string) {
		super("CONFLICT", message);
		this.name = "PreviewConflictError";
	}
}

export class PreviewNotFoundError extends DomainError {
	constructor(message: string) {
		super("NOT_FOUND", message);
		this.name = "PreviewNotFoundError";
	}
}

/**
 * The application already runs `previewLimit` previews. Refusing (rather than
 * silently evicting the oldest) is the safe default: a PR whose preview is
 * still under review must not be torn down because a newer PR opened.
 */
export class PreviewLimitError extends DomainError {
	constructor(message: string) {
		super("PRECONDITION_FAILED", message);
		this.name = "PreviewLimitError";
	}
}

/** `previewLimit <= 0` means "no cap". */
export function previewLimitReached(current: number, limit: number | null | undefined): boolean {
	if (!limit || limit <= 0) return false;
	return current >= limit;
}

/** Expiry a webhook-created preview inherits from `previewTtlHours`. */
export function previewExpiryFromTtl(
	ttlHours: number | null | undefined,
	now: Date = new Date(),
): Date | null {
	if (!ttlHours || ttlHours <= 0) return null;
	return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
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

	// Per-application cap (product audit, Previews row): previews inherit the
	// parent's resources, so an active repo could otherwise fill the node with
	// one swarm service per open PR.
	const [live] = await db
		.select({ value: count() })
		.from(previewDeployments)
		.where(eq(previewDeployments.applicationId, application.applicationId));
	const current = live?.value ?? 0;
	if (previewLimitReached(current, application.previewLimit)) {
		// Tell the PR author why nothing was deployed — the webhook itself is
		// answered with a 200 and nobody reads the panel's logs.
		const { upsertPreviewComment } = await import("./comment");
		await upsertPreviewComment({
			applicationId: application.applicationId,
			pullRequestNumber: input.pullRequestNumber,
			status: "limit_reached",
		}).catch(() => {});
		throw new PreviewLimitError(
			`Preview limit reached for "${application.name}": ${current} of ${application.previewLimit} previews already exist. Delete one, or raise the limit on the Previews tab.`,
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
			commitSha: input.commitSha ?? null,
			commitMessage: input.commitMessage ?? null,
			commitAuthor: input.commitAuthor ?? null,
			commitUrl: input.commitUrl ?? null,
			previewStatus: input.deferDeploy ? "awaiting_approval" : "running",
			// An explicit expiry (manual create) wins; otherwise the app's
			// default TTL applies, which is what makes webhook previews expire.
			expiresAt: input.expiresAt ?? previewExpiryFromTtl(application.previewTtlHours),
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
			return {
				...preview,
				domainId: domain?.domainId ?? null,
				domain: domain ?? null,
			};
		}

		const deploymentId = await queueDeployment({
			applicationId: application.applicationId,
			previewDeploymentId: preview.previewDeploymentId,
			type: "deploy",
			trigger: "preview",
			triggeredBy: input.triggeredBy ?? null,
			commitSha: input.commitSha ?? null,
			commitMessage: input.commitMessage ?? null,
			commitAuthor: input.commitAuthor ?? null,
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
	provenance: PreviewProvenance = {},
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
		trigger: "preview",
		triggeredBy: provenance.triggeredBy ?? null,
		// Fall back to what the preview row already knows: an "approve" click
		// carries no payload, but the PR it approves does have a head commit.
		commitSha: provenance.commitSha ?? preview.commitSha ?? null,
		commitMessage: provenance.commitMessage ?? preview.commitMessage ?? null,
		commitAuthor: provenance.commitAuthor ?? preview.commitAuthor ?? null,
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
		const commitPatch = commitColumns(input);
		if (
			input.branch ||
			input.pullRequestTitle ||
			input.pullRequestURL ||
			input.pullRequestId ||
			input.pullRequestAuthor ||
			Object.keys(commitPatch).length > 0
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
					...commitPatch,
				})
				.where(eq(previewDeployments.previewDeploymentId, existing.previewDeploymentId));
		}
		const result = await redeployPreviewDeployment(existing.previewDeploymentId, {
			triggeredBy: input.triggeredBy,
			commitSha: input.commitSha,
			commitMessage: input.commitMessage,
			commitAuthor: input.commitAuthor,
		});
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

	// Service objects live on the primary manager whatever server the
	// preview inherited from its parent.
	await removeSwarmService(preview.appName).catch(() => {
		// variant may never have been deployed
	});
	// The PR build is tagged `<app>-pr-<n>:latest` on the server that built
	// it; nothing else references it.
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
