import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments, previewDeployments } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { getComposeCodeDir } from "../compose/paths";
import { getAppCodePath, shellQuote } from "../deployment/paths";
import {
	classifyPullRequestAction,
	createOrRedeployPreview,
	createPreviewDeployment,
	deletePreviewByPullRequest,
	findPreviewByPullRequest,
	loadPreviewParent,
	type PreviewParent,
	type PreviewParentRef,
} from "../preview";
import { upsertPreviewComment } from "../preview/comment";
import { decideForkPreviewGate, type ForkGateDecision } from "../preview/fork-gate";
import { isMetadataOnlyPullRequestUpdate } from "../preview/source-ref";
import { isBitbucketCollaborator } from "./bitbucket";
import { commitUrlForApplication, commitUrlForCompose } from "./commit-link";
import { isGiteaCollaborator } from "./gitea";
import { isGithubCollaborator } from "./github";
import { isGitlabCollaborator } from "./gitlab";
import type { GitWebhookResult, PullRequestWebhookInfo } from "./providers/shared";
import { WebhookIgnored } from "./providers/shared";

/**
 * Preview lifecycle of a verified pull_request delivery: the fork approval
 * gate (provider collaborator lookup) and create / redeploy / delete.
 *
 * Applications and compose services share every step — they expose the same
 * provider columns and the same preview knobs through `PreviewParent`
 * (`modules/preview/parent.ts`) — so the flow is written once and entered
 * through the two thin wrappers at the bottom.
 */

/**
 * Fork gate for one PR delivery: consult the parent's
 * `previewForksRequireApproval` setting and the provider collaborator /
 * membership API (fail-safe: unknown collaborator status ⇒ gated).
 */
async function evaluateForkGate(
	parent: PreviewParent,
	pr: PullRequestWebhookInfo,
): Promise<ForkGateDecision> {
	if (!pr.isFork) return "allow";
	let isCollaborator: boolean | null = null;
	const owner = parent.owner;
	const repo = parent.repository;
	const username = pr.authorLogin;
	if (owner && repo && username) {
		if (parent.sourceType === "github" && parent.githubId) {
			isCollaborator = await isGithubCollaborator({
				githubId: parent.githubId,
				owner,
				repo,
				username,
			});
		} else if (parent.sourceType === "gitlab" && parent.gitlabId) {
			isCollaborator = await isGitlabCollaborator({
				gitlabId: parent.gitlabId,
				owner,
				repo,
				username,
			});
		} else if (parent.sourceType === "gitea" && parent.giteaId) {
			isCollaborator = await isGiteaCollaborator({
				giteaId: parent.giteaId,
				owner,
				repo,
				username,
			});
		} else if (parent.sourceType === "bitbucket" && parent.bitbucketId) {
			isCollaborator = await isBitbucketCollaborator({
				bitbucketId: parent.bitbucketId,
				owner,
				repo,
				username,
			});
		}
	}
	return decideForkPreviewGate({
		isFork: true,
		requireApproval: parent.previewForksRequireApproval,
		isCollaborator,
	});
}

/**
 * Commit the preview's checkout currently sits at (the deploy engine leaves
 * `<code dir>` reset to the last fetched head). Null when unknown — never
 * deployed, checkout wiped, server unreachable — which always rebuilds.
 */
async function readCheckoutCommit(
	parent: PreviewParent,
	preview: { appName: string; serverId: string | null },
): Promise<string | null> {
	const codeDir =
		parent.kind === "compose"
			? getComposeCodeDir(preview.appName)
			: getAppCodePath(preview.appName);
	const command = `git -C ${shellQuote(codeDir)} rev-parse HEAD`;
	try {
		const out = preview.serverId
			? await execAsyncRemote(preview.serverId, command, { timeoutMs: 15_000 })
			: await execAsync(command, { timeout: 15_000 });
		const sha = out.trim();
		return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

/**
 * Commit page for a PR's head commit: the payload's own link when the
 * provider sent one, otherwise built from the parent's source row and
 * the base URL of the git-provider it is linked to (so self-hosted GitLab /
 * Gitea land on their own host rather than the vendor cloud).
 */
async function resolvePreviewCommitUrl(
	parent: PreviewParent,
	pr: PullRequestWebhookInfo,
): Promise<string | null> {
	if (pr.headCommitUrl) return pr.headCommitUrl;
	if (!pr.headCommit) return null;
	const resolve =
		parent.kind === "compose"
			? commitUrlForCompose(parent.id, pr.headCommit)
			: commitUrlForApplication(parent.id, pr.headCommit);
	return await resolve.catch(() => null);
}

/** `{ applicationId }` or `{ composeId }` for the preview lifecycle calls. */
const refFor = (parent: PreviewParent): PreviewParentRef =>
	parent.kind === "application" ? { applicationId: parent.id } : { composeId: parent.id };

/**
 * Apply a verified pull_request webhook to one preview parent: create /
 * redeploy on open/sync, delete on close. Returns a short status string for
 * the HTTP response.
 */
async function handlePreviewWebhookForParent(
	parent: PreviewParent,
	webhook: GitWebhookResult,
): Promise<{
	action: string;
	previewDeploymentId?: string;
	deploymentId?: string;
}> {
	const ref = refFor(parent);
	const pr = webhook.pullRequest;
	if (!pr?.number) {
		throw new WebhookIgnored("pull_request webhook carried no PR number");
	}

	const kind = classifyPullRequestAction(pr.action);
	if (kind === "ignore") {
		return { action: "ignored" };
	}

	if (kind === "delete") {
		const deleted = await deletePreviewByPullRequest(ref, pr.number);
		if (deleted) {
			await upsertPreviewComment({
				...ref,
				pullRequestNumber: pr.number,
				status: "removed",
			});
		}
		return {
			action: deleted ? "deleted" : "noop",
			previewDeploymentId: deleted?.previewDeploymentId,
		};
	}

	// Bitbucket's `pullrequest:updated` also fires for title/description/
	// reviewer edits; skip the rebuild when the head commit is what the
	// preview already checked out.
	const existingPreview = await findPreviewByPullRequest(ref, pr.number);
	if (existingPreview && pr.headCommit) {
		const deployedCommit = await readCheckoutCommit(parent, existingPreview);
		if (
			isMetadataOnlyPullRequestUpdate({
				action: pr.action,
				headCommit: pr.headCommit,
				deployedCommit,
			})
		) {
			return {
				action: "ignored",
				previewDeploymentId: existingPreview.previewDeploymentId,
			};
		}
	}

	const sourceRef = pr.sourceRef ?? webhook.branch ?? null;
	const provenance = {
		triggeredBy: `webhook:${webhook.provider}`,
		commitSha: pr.headCommit ?? null,
		commitMessage: pr.headCommitMessage ?? null,
		commitAuthor: pr.headCommitAuthor ?? null,
		// Prefer the URL the payload carried (it names the real host, fork
		// repositories included); derive one from the parent's provider
		// row only when the provider sent none.
		commitUrl: await resolvePreviewCommitUrl(parent, pr),
	};
	const result = await (async () => {
		const gate = await evaluateForkGate(parent, pr);
		const input = {
			...ref,
			pullRequestNumber: pr.number,
			branch: sourceRef || null,
			pullRequestId: pr.id ?? null,
			pullRequestTitle: pr.title ?? null,
			pullRequestURL: pr.url ?? null,
			pullRequestAuthor: pr.authorLogin ?? null,
			...provenance,
		};
		if (gate === "allow") {
			return await createOrRedeployPreview(input);
		}

		// Fork PR + approval required + author not a known collaborator: never
		// auto-build arbitrary code. Park the preview as awaiting_approval.
		const existing = existingPreview;
		if (existing && existing.previewStatus !== "awaiting_approval") {
			// Approved earlier (or predates the gate) — keep it redeploying.
			return await createOrRedeployPreview(input);
		}
		if (existing) {
			// Still gated: refresh PR metadata only, no build.
			await db
				.update(previewDeployments)
				.set({
					branch: input.branch,
					pullRequestId: input.pullRequestId,
					pullRequestTitle: input.pullRequestTitle,
					pullRequestURL: input.pullRequestURL,
					pullRequestAuthor: input.pullRequestAuthor,
					// A gated fork PR never builds, so the preview row is the
					// only place its head commit is ever recorded.
					...(input.commitSha ? { commitSha: input.commitSha } : {}),
					...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
					...(input.commitAuthor ? { commitAuthor: input.commitAuthor } : {}),
					...(input.commitUrl ? { commitUrl: input.commitUrl } : {}),
				})
				.where(eq(previewDeployments.previewDeploymentId, existing.previewDeploymentId));
			await upsertPreviewComment({
				...ref,
				pullRequestNumber: pr.number,
				status: "awaiting_approval",
			});
			return {
				action: "awaiting_approval" as const,
				previewDeploymentId: existing.previewDeploymentId,
				deploymentId: "",
			};
		}
		const created = await createPreviewDeployment({ ...input, deferDeploy: true });
		await upsertPreviewComment({
			...ref,
			pullRequestNumber: pr.number,
			status: "awaiting_approval",
		});
		return {
			action: "awaiting_approval" as const,
			previewDeploymentId: created.previewDeploymentId,
			deploymentId: "",
		};
	})();

	const title = `Preview: PR #${pr.number} (${result.action})`;
	if (result.deploymentId) {
		await db
			.update(deployments)
			.set({ title, isPreview: true })
			.where(eq(deployments.deploymentId, result.deploymentId));
	}

	if (result.action !== "awaiting_approval") {
		await upsertPreviewComment({
			...ref,
			pullRequestNumber: pr.number,
			status: "deploying",
		});
	}

	return {
		action: result.action,
		previewDeploymentId: result.previewDeploymentId,
		deploymentId: result.deploymentId,
	};
}

/** Apply a verified pull_request webhook to one application. */
export async function handlePreviewWebhookForApplication(
	applicationId: string,
	webhook: GitWebhookResult,
): Promise<{ action: string; previewDeploymentId?: string; deploymentId?: string }> {
	const parent = await loadPreviewParent({ applicationId });
	// Deleted between match and apply.
	if (!parent) return { action: "noop" };
	return await handlePreviewWebhookForParent(parent, webhook);
}

/** Apply a verified pull_request webhook to one compose service. */
export async function handlePreviewWebhookForCompose(
	composeId: string,
	webhook: GitWebhookResult,
): Promise<{ action: string; previewDeploymentId?: string; deploymentId?: string }> {
	const parent = await loadPreviewParent({ composeId });
	if (!parent) return { action: "noop" };
	return await handlePreviewWebhookForParent(parent, webhook);
}
