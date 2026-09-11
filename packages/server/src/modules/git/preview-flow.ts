import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, deployments, previewDeployments } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { getAppCodePath, shellQuote } from "../deployment/paths";
import {
	classifyPullRequestAction,
	createOrRedeployPreview,
	createPreviewDeployment,
	deletePreviewByPullRequest,
	findPreviewByPullRequest,
} from "../preview";
import { upsertPreviewComment } from "../preview/comment";
import { decideForkPreviewGate, type ForkGateDecision } from "../preview/fork-gate";
import { isMetadataOnlyPullRequestUpdate } from "../preview/source-ref";
import { isBitbucketCollaborator } from "./bitbucket";
import { commitUrlForApplication } from "./commit-link";
import { isGiteaCollaborator } from "./gitea";
import { isGithubCollaborator } from "./github";
import { isGitlabCollaborator } from "./gitlab";
import type { GitWebhookResult, PullRequestWebhookInfo } from "./providers/shared";
import { WebhookIgnored } from "./providers/shared";

/**
 * Preview lifecycle of a verified pull_request delivery: the fork approval
 * gate (provider collaborator lookup) and create / redeploy / delete.
 */

/**
 * Fork gate for one PR delivery: consult the app's
 * `previewForksRequireApproval` setting and the provider collaborator /
 * membership API (fail-safe: unknown collaborator status ⇒ gated).
 */
async function evaluateForkGate(
	applicationId: string,
	pr: PullRequestWebhookInfo,
): Promise<ForkGateDecision> {
	if (!pr.isFork) return "allow";
	const application = await db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
		columns: {
			sourceType: true,
			owner: true,
			repository: true,
			githubId: true,
			gitlabId: true,
			giteaId: true,
			bitbucketId: true,
			previewForksRequireApproval: true,
		},
	});
	if (!application) return "allow"; // deleted between match and apply
	let isCollaborator: boolean | null = null;
	const owner = application.owner;
	const repo = application.repository;
	const username = pr.authorLogin;
	if (owner && repo && username) {
		if (application.sourceType === "github" && application.githubId) {
			isCollaborator = await isGithubCollaborator({
				githubId: application.githubId,
				owner,
				repo,
				username,
			});
		} else if (application.sourceType === "gitlab" && application.gitlabId) {
			isCollaborator = await isGitlabCollaborator({
				gitlabId: application.gitlabId,
				owner,
				repo,
				username,
			});
		} else if (application.sourceType === "gitea" && application.giteaId) {
			isCollaborator = await isGiteaCollaborator({
				giteaId: application.giteaId,
				owner,
				repo,
				username,
			});
		} else if (application.sourceType === "bitbucket" && application.bitbucketId) {
			isCollaborator = await isBitbucketCollaborator({
				bitbucketId: application.bitbucketId,
				owner,
				repo,
				username,
			});
		}
	}
	return decideForkPreviewGate({
		isFork: true,
		requireApproval: application.previewForksRequireApproval,
		isCollaborator,
	});
}

/**
 * Commit the preview's checkout currently sits at (the deploy engine leaves
 * `<code dir>` reset to the last fetched head). Null when unknown — never
 * deployed, checkout wiped, server unreachable — which always rebuilds.
 */
async function readCheckoutCommit(preview: {
	appName: string;
	serverId: string | null;
}): Promise<string | null> {
	const command = `git -C ${shellQuote(getAppCodePath(preview.appName))} rev-parse HEAD`;
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
 * provider sent one, otherwise built from the application's source row and
 * the base URL of the git-provider it is linked to (so self-hosted GitLab /
 * Gitea land on their own host rather than the vendor cloud).
 */
async function resolvePreviewCommitUrl(
	applicationId: string,
	pr: PullRequestWebhookInfo,
): Promise<string | null> {
	if (pr.headCommitUrl) return pr.headCommitUrl;
	if (!pr.headCommit) return null;
	return await commitUrlForApplication(applicationId, pr.headCommit).catch(() => null);
}

/**
 * Apply a verified pull_request webhook to one application: create/redeploy
 * on open/sync, delete on close. Returns a short status string for the HTTP
 * response.
 */
export async function handlePreviewWebhookForApplication(
	applicationId: string,
	webhook: GitWebhookResult,
): Promise<{
	action: string;
	previewDeploymentId?: string;
	deploymentId?: string;
}> {
	const pr = webhook.pullRequest;
	if (!pr?.number) {
		throw new WebhookIgnored("pull_request webhook carried no PR number");
	}

	const kind = classifyPullRequestAction(pr.action);
	if (kind === "ignore") {
		return { action: "ignored" };
	}

	if (kind === "delete") {
		const deleted = await deletePreviewByPullRequest(applicationId, pr.number);
		if (deleted) {
			await upsertPreviewComment({
				applicationId,
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
	const existingPreview = await findPreviewByPullRequest(applicationId, pr.number);
	if (existingPreview && pr.headCommit) {
		const deployedCommit = await readCheckoutCommit(existingPreview);
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
		// repositories included); derive one from the application's provider
		// row only when the provider sent none.
		commitUrl: await resolvePreviewCommitUrl(applicationId, pr),
	};
	const result = await (async () => {
		const gate = await evaluateForkGate(applicationId, pr);
		if (gate === "allow") {
			return await createOrRedeployPreview({
				applicationId,
				pullRequestNumber: pr.number,
				branch: sourceRef || null,
				pullRequestId: pr.id ?? null,
				pullRequestTitle: pr.title ?? null,
				pullRequestURL: pr.url ?? null,
				pullRequestAuthor: pr.authorLogin ?? null,
				...provenance,
			});
		}

		// Fork PR + approval required + author not a known collaborator: never
		// auto-build arbitrary code. Park the preview as awaiting_approval.
		const gatedInput = {
			applicationId,
			pullRequestNumber: pr.number,
			branch: sourceRef || null,
			pullRequestId: pr.id ?? null,
			pullRequestTitle: pr.title ?? null,
			pullRequestURL: pr.url ?? null,
			pullRequestAuthor: pr.authorLogin ?? null,
			...provenance,
		};
		const existing = existingPreview;
		if (existing && existing.previewStatus !== "awaiting_approval") {
			// Approved earlier (or predates the gate) — keep it redeploying.
			return await createOrRedeployPreview(gatedInput);
		}
		if (existing) {
			// Still gated: refresh PR metadata only, no build.
			await db
				.update(previewDeployments)
				.set({
					branch: gatedInput.branch,
					pullRequestId: gatedInput.pullRequestId,
					pullRequestTitle: gatedInput.pullRequestTitle,
					pullRequestURL: gatedInput.pullRequestURL,
					pullRequestAuthor: gatedInput.pullRequestAuthor,
					// A gated fork PR never builds, so the preview row is the
					// only place its head commit is ever recorded.
					...(gatedInput.commitSha ? { commitSha: gatedInput.commitSha } : {}),
					...(gatedInput.commitMessage ? { commitMessage: gatedInput.commitMessage } : {}),
					...(gatedInput.commitAuthor ? { commitAuthor: gatedInput.commitAuthor } : {}),
					...(gatedInput.commitUrl ? { commitUrl: gatedInput.commitUrl } : {}),
				})
				.where(eq(previewDeployments.previewDeploymentId, existing.previewDeploymentId));
			await upsertPreviewComment({
				applicationId,
				pullRequestNumber: pr.number,
				status: "awaiting_approval",
			});
			return {
				action: "awaiting_approval" as const,
				previewDeploymentId: existing.previewDeploymentId,
				deploymentId: "",
			};
		}
		const created = await createPreviewDeployment({
			...gatedInput,
			deferDeploy: true,
		});
		await upsertPreviewComment({
			applicationId,
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
			applicationId,
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
