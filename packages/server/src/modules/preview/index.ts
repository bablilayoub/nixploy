import { and, count, eq } from "drizzle-orm";
import { db } from "../../db";
import { compose, domains, previewDeployments } from "../../db/schema";
import { removeApplicationImages, removeSwarmService } from "../application/docker";
import { queueDeployment } from "../deployment";
import { DomainError } from "../errors";
import {
	listComposeExposedServices,
	removePreviewComposeFiles,
	teardownPreviewComposeProject,
} from "./compose";
import { dropPreviewDatabase, ensurePreviewDatabase } from "./database";
import {
	previewAppName,
	previewComposeHost,
	previewExpiryFromTtl,
	previewHost,
	previewLimitReached,
} from "./naming";
import {
	loadPreviewParent,
	loadPreviewParentForPreview,
	type PreviewParent,
	type PreviewParentRef,
	previewParentRef,
} from "./parent";
import { removePreviewTraefik, syncPreviewTraefik } from "./traefik";

export { buildPreviewComposeTarget, listComposeExposedServices } from "./compose";
export {
	previewAppName,
	previewComposeHost,
	previewExpiryFromTtl,
	previewHost,
	previewKeyForRef,
	previewLimitReached,
} from "./naming";
export {
	applicationPreviewParent,
	composePreviewParent,
	loadPreviewParent,
	loadPreviewParentForPreview,
	type PreviewParent,
	type PreviewParentKind,
	type PreviewParentRef,
	previewParentRef,
} from "./parent";
export {
	encodePreviewSourceRef,
	isMetadataOnlyPullRequestUpdate,
	type PreviewSourceRef,
	parsePreviewSourceRef,
	previewSourceRefForPullRequest,
	pullRequestHeadRef,
} from "./source-ref";
export { composePreviewTraefikKey, removePreviewTraefik, syncPreviewTraefik } from "./traefik";

export type CreatePreviewInput = PreviewParentRef & {
	/**
	 * `pull_request` (default): `pullRequestNumber` is the PR number and the
	 * provider machinery applies. `branch`: `pullRequestNumber` is the key
	 * derived from the ref (`previewKeyForRef`), `branch` is the ref, and no
	 * comment, fork gate or webhook ever touches the row.
	 */
	kind?: "pull_request" | "branch";
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
	/** First route (an application preview has exactly one); null when unrouted. */
	domain: typeof domains.$inferSelect | null;
	/** Every route: one per exposed compose service, one (or none) for an application. */
	domains: (typeof domains.$inferSelect)[];
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
 * The parent already runs `previewLimit` previews. Refusing (rather than
 * silently evicting the oldest) is the safe default: a PR whose preview is
 * still under review must not be torn down because a newer PR opened.
 */
export class PreviewLimitError extends DomainError {
	constructor(message: string) {
		super("PRECONDITION_FAILED", message);
		this.name = "PreviewLimitError";
	}
}

/** Attach the preview's domain rows (1 for an application, 1..n for compose). */
export async function withPreviewDomain<T extends { previewDeploymentId: string }>(
	preview: T,
): Promise<
	T & { domain: typeof domains.$inferSelect | null; domains: (typeof domains.$inferSelect)[] }
> {
	const rows = await db.query.domains.findMany({
		where: eq(domains.previewDeploymentId, preview.previewDeploymentId),
	});
	return { ...preview, domain: rows[0] ?? null, domains: rows };
}

/** Live previews of one parent (the `previewLimit` cap). */
async function countPreviews(parent: PreviewParent): Promise<number> {
	const [live] = await db
		.select({ value: count() })
		.from(previewDeployments)
		.where(
			parent.kind === "application"
				? eq(previewDeployments.applicationId, parent.id)
				: eq(previewDeployments.composeId, parent.id),
		);
	return live?.value ?? 0;
}

/** The ref form a parent takes in inputs and audit metadata. */
const refFor = (parent: PreviewParent): PreviewParentRef =>
	parent.kind === "application" ? { applicationId: parent.id } : { composeId: parent.id };

/**
 * Domain rows a new preview needs. An application preview gets one route,
 * mirroring the parent's first production domain (container port and TLS);
 * a compose preview gets one per compose service that has a production HTTP
 * domain, each mirroring that service's own settings.
 */
async function previewDomainValues(
	parent: PreviewParent,
	pullRequestNumber: string,
	previewDeploymentId: string,
): Promise<(typeof domains.$inferInsert)[]> {
	if (parent.kind === "application") {
		// The parent's first production domain tells us the container port the
		// app listens on and which TLS settings to mirror.
		const parentDomain = await db.query.domains.findFirst({
			where: and(eq(domains.applicationId, parent.id), eq(domains.domainType, "application")),
		});
		const https = Boolean(parentDomain?.https);
		return [
			{
				host: previewHost(parent.appName, pullRequestNumber),
				path: "/",
				// Same container port as production: a static build serves on
				// nginx:80, a Go app on 8080 — hardcoding 3000 502'd all of them.
				port: parentDomain?.port ?? null,
				https,
				certificateType: https ? (parentDomain?.certificateType ?? "letsencrypt") : "none",
				certificateId: https ? (parentDomain?.certificateId ?? null) : null,
				domainType: "preview" as const,
				applicationId: parent.id,
				previewDeploymentId,
			},
		];
	}

	const exposed = await listComposeExposedServices(parent.id);
	return exposed.map((service) => ({
		host: previewComposeHost(parent.appName, pullRequestNumber, service.serviceName),
		path: "/",
		port: service.port,
		https: service.https,
		certificateType: service.certificateType as "none" | "letsencrypt" | "custom",
		certificateId: service.certificateId,
		domainType: "preview" as const,
		composeId: parent.id,
		// Routing targets the SOURCE service name; the deploy renders the
		// preview project's alias for it.
		serviceName: service.serviceName,
		previewDeploymentId,
	}));
}

/**
 * Spin up a per-PR variant: insert preview + domain rows, write Traefik
 * config, and enqueue a deploy of the isolated preview service / project
 * (never production).
 */
export async function createPreviewDeployment(
	input: CreatePreviewInput,
): Promise<PreviewWithDomain> {
	const parent = await loadPreviewParent(input);
	if (!parent) {
		const target = previewParentRef(input);
		throw new PreviewNotFoundError(
			target
				? `${target.kind === "application" ? "Application" : "Compose service"} not found: ${target.id}`
				: "A preview needs exactly one of applicationId or composeId",
		);
	}

	const kind = input.kind ?? "pull_request";
	const variantAppName = previewAppName(parent.appName, input.pullRequestNumber);
	const existing = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.appName, variantAppName),
	});
	if (existing) {
		throw new PreviewConflictError(
			kind === "pull_request"
				? `A preview deployment for PR #${input.pullRequestNumber} already exists`
				: `A preview for ref "${input.branch ?? ""}" already exists (${existing.appName})`,
		);
	}

	// Per-parent cap (product audit, Previews row): previews inherit the
	// parent's resources, so an active repo could otherwise fill the node with
	// one service / stack per open PR.
	const current = await countPreviews(parent);
	if (previewLimitReached(current, parent.previewLimit)) {
		// Tell the PR author why nothing was deployed — the webhook itself is
		// answered with a 200 and nobody reads the panel's logs. A branch
		// preview has no PR to tell; its caller gets the error directly.
		if (kind === "pull_request") {
			const { upsertPreviewComment } = await import("./comment");
			await upsertPreviewComment({
				...refFor(parent),
				pullRequestNumber: input.pullRequestNumber,
				status: "limit_reached",
			}).catch(() => {});
		}
		throw new PreviewLimitError(
			`Preview limit reached for "${parent.name}": ${current} of ${parent.previewLimit} previews already exist. Delete one, or raise the limit on the Previews tab.`,
		);
	}

	const [preview] = await db
		.insert(previewDeployments)
		.values({
			appName: variantAppName,
			kind,
			branch: input.branch ?? parent.defaultBranch,
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
			// An explicit expiry (manual create) wins; otherwise the parent's
			// default TTL applies, which is what makes webhook previews expire.
			expiresAt: input.expiresAt ?? previewExpiryFromTtl(parent.previewTtlHours),
			applicationId: parent.kind === "application" ? parent.id : null,
			composeId: parent.kind === "compose" ? parent.id : null,
			serverId: parent.serverId,
		})
		.returning();
	if (!preview) {
		throw new Error("Failed to create preview deployment");
	}

	// Compensation on any failure below: without it the preview row survives
	// and every subsequent webhook for this PR hits PreviewConflictError.
	try {
		const values = await previewDomainValues(
			parent,
			input.pullRequestNumber,
			preview.previewDeploymentId,
		);
		const created = values.length > 0 ? await db.insert(domains).values(values).returning() : [];

		const first = created[0];
		if (first) {
			await db
				.update(previewDeployments)
				.set({ domainId: first.domainId })
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
				domainId: first?.domainId ?? null,
				domain: first ?? null,
				domains: created,
			};
		}

		// Its own database, when the parent asks for one — before the build so
		// the worker can hand the preview its DATABASE_URL and seed it.
		await ensurePreviewDatabase(parent, {
			previewDeploymentId: preview.previewDeploymentId,
			appName: preview.appName,
			previewDatabaseLogicalId: null,
		});

		const deploymentId = await queueDeployment({
			applicationId: parent.kind === "application" ? parent.id : undefined,
			composeId: parent.kind === "compose" ? parent.id : undefined,
			previewDeploymentId: preview.previewDeploymentId,
			type: "deploy",
			trigger: "preview",
			triggeredBy: input.triggeredBy ?? null,
			commitSha: input.commitSha ?? null,
			commitMessage: input.commitMessage ?? null,
			commitAuthor: input.commitAuthor ?? null,
		});
		// "pending" on the commit when it is known up front (webhook payloads);
		// a branch preview learns its sha from the checkout and gets the
		// terminal status from the worker instead.
		void import("./status").then(({ reportPreviewCommitStatus }) =>
			reportPreviewCommitStatus({
				previewDeploymentId: preview.previewDeploymentId,
				state: "pending",
				deploymentId,
			}),
		);

		return {
			...preview,
			domainId: first?.domainId ?? null,
			domain: first ?? null,
			domains: created,
			deploymentId,
		};
	} catch (error) {
		await removePreviewTraefik(preview).catch(() => {});
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

	// A preview created before the parent opted into per-preview databases,
	// or one approved through the fork gate, gets its database on the way.
	const parent = await loadPreviewParentForPreview(preview);
	if (parent) {
		await ensurePreviewDatabase(parent, preview);
	}

	await db
		.update(previewDeployments)
		.set({ previewStatus: "running" })
		.where(eq(previewDeployments.previewDeploymentId, previewDeploymentId));

	const deploymentId = await queueDeployment({
		applicationId: preview.applicationId ?? undefined,
		composeId: preview.composeId ?? undefined,
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
	void import("./status").then(({ reportPreviewCommitStatus }) =>
		reportPreviewCommitStatus({
			previewDeploymentId: preview.previewDeploymentId,
			state: "pending",
			deploymentId,
		}),
	);

	return { previewDeploymentId: preview.previewDeploymentId, deploymentId };
}

/**
 * Find a preview by parent + PR number, or null if none exists.
 */
export async function findPreviewByPullRequest(ref: PreviewParentRef, pullRequestNumber: string) {
	const parent = await loadPreviewParent(ref);
	if (!parent) return null;
	const variantAppName = previewAppName(parent.appName, pullRequestNumber);
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
	const existing = await findPreviewByPullRequest(input, input.pullRequestNumber);
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

/**
 * Tear down a preview: the running service / compose project, its Traefik
 * YAML, on-disk state and the domain + preview rows.
 */
export async function deletePreviewDeployment(
	previewDeploymentId: string,
): Promise<{ previewDeploymentId: string }> {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) {
		throw new PreviewNotFoundError(`Preview deployment not found: ${previewDeploymentId}`);
	}

	// The database goes before the service so a failed drop is logged while
	// the preview still exists to retry from; the logical row stays either way.
	await dropPreviewDatabase(preview);

	if (preview.composeId) {
		const parent = await db.query.compose.findFirst({
			where: eq(compose.composeId, preview.composeId),
		});
		if (parent) {
			// A preview that never deployed has no project — tolerate the failure.
			await teardownPreviewComposeProject(parent, preview.appName).catch(() => {});
			await removePreviewComposeFiles(parent, preview.appName).catch(() => {});
		}
	} else {
		const parent = await loadPreviewParent({ applicationId: preview.applicationId });
		const serverId = parent?.serverId ?? preview.serverId;
		// Service objects live on the primary manager whatever server the
		// preview inherited from its parent.
		await removeSwarmService(preview.appName).catch(() => {
			// variant may never have been deployed
		});
		// The PR build is tagged `<app>-pr-<n>:latest` on the server that built
		// it; nothing else references it.
		await removeApplicationImages(preview.appName, serverId).catch(() => {});
	}

	// Routing YAML always lives on the Nixploy host (where Traefik runs).
	await removePreviewTraefik(preview);
	await db.delete(domains).where(eq(domains.previewDeploymentId, preview.previewDeploymentId));
	await db
		.delete(previewDeployments)
		.where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));

	return { previewDeploymentId: preview.previewDeploymentId };
}

/**
 * Delete the preview for a parent + PR number if it exists.
 * No-op when missing (idempotent webhook close).
 */
export async function deletePreviewByPullRequest(
	ref: PreviewParentRef,
	pullRequestNumber: string,
): Promise<{ previewDeploymentId: string } | null> {
	const existing = await findPreviewByPullRequest(ref, pullRequestNumber);
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
