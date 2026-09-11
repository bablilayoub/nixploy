import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications } from "../../db/schema";
import { type DeploymentProvenance, queueDeployment } from "../deployment";
import { classifyPullRequestAction } from "../preview";
import { previewSourceRefForPullRequest } from "../preview/source-ref";
import {
	applicationMatchesPreviewWebhook,
	applicationMatchesWebhook,
	type WebhookRepoContext,
} from "./match";
import { verifyAndExtractBitbucket } from "./providers/bitbucket";
import { verifyAndExtractGitea } from "./providers/gitea";
import { verifyAndExtractGithub } from "./providers/github";
import { verifyAndExtractGitlab } from "./providers/gitlab";
import {
	type GitWebhookProvider,
	type GitWebhookResult,
	type WebhookHeaders,
	WebhookIgnored,
} from "./providers/shared";

/**
 * Webhook dispatcher: verify a delivery through the provider module, then
 * resolve the applications that should react to it. Fork gating and the
 * preview lifecycle live in `./preview-flow.ts`.
 */

const PROVIDER_COLUMN = {
	github: applications.githubId,
	gitlab: applications.gitlabId,
	bitbucket: applications.bitbucketId,
	gitea: applications.giteaId,
} as const;

/**
 * Verify an incoming git webhook, extract repo/branch, and return the
 * applications that should react. `body` must be the *raw* request body
 * (string) for signature verification. Webhooks are machine-to-machine
 * calls without a session, so matching is intentionally not org-scoped —
 * it relies on provider credential verification instead. When `providerId`
 * is given (from the webhook URL), the delivery is verified against that
 * provider row only and only applications linked to it can match.
 *
 * Push/tag → apps with autoDeploy matching repo+branch.
 * Pull request → apps with isPreviewDeploymentsActive matching repo only.
 */
export async function handleGitWebhook(
	provider: GitWebhookProvider,
	headers: WebhookHeaders,
	body: string | object,
	providerId?: string,
): Promise<GitWebhookResult> {
	const rawBody = typeof body === "string" ? body : JSON.stringify(body);

	const extracted = await (async () => {
		switch (provider) {
			case "github":
				return await verifyAndExtractGithub(headers, rawBody, providerId);
			case "gitlab":
				return await verifyAndExtractGitlab(headers, rawBody, providerId);
			case "bitbucket":
				return await verifyAndExtractBitbucket(headers, rawBody, providerId);
			case "gitea":
				return await verifyAndExtractGitea(headers, rawBody, providerId);
		}
	})();

	if (extracted.type === "pull_request") {
		if (!extracted.pullRequest?.number) {
			throw new WebhookIgnored("pull_request webhook carried no PR number");
		}
		const kind = classifyPullRequestAction(extracted.pullRequest.action);
		if (kind === "ignore") {
			throw new WebhookIgnored(`ignored pull_request action: ${extracted.pullRequest.action}`);
		}
		// Closed PRs may omit head branch; upsert still needs a branch.
		if (kind === "upsert" && !extracted.branch) {
			throw new WebhookIgnored("pull_request webhook carried no branch");
		}
		// Fork PRs cannot be fetched by branch name from the base repo: pin the
		// provider's PR head ref (or the fork repository on Bitbucket) instead.
		extracted.pullRequest.sourceRef = previewSourceRefForPullRequest({
			provider,
			number: extracted.pullRequest.number,
			branch: extracted.branch,
			isFork: Boolean(extracted.pullRequest.isFork),
			headRepoFullName: extracted.pullRequest.headRepoFullName,
		});
		if (kind === "upsert" && !extracted.pullRequest.sourceRef) {
			throw new WebhookIgnored("fork pull_request webhook carried no fetchable source");
		}

		const conditions = [
			eq(applications.sourceType, provider),
			eq(applications.isPreviewDeploymentsActive, true),
		];
		if (providerId) {
			conditions.push(eq(PROVIDER_COLUMN[provider], providerId));
		}
		const candidates = await db
			.select({
				applicationId: applications.applicationId,
				sourceType: applications.sourceType,
				repository: applications.repository,
				owner: applications.owner,
				isPreviewDeploymentsActive: applications.isPreviewDeploymentsActive,
			})
			.from(applications)
			.where(and(...conditions));

		const context = {
			provider,
			repository: extracted.repository,
			owner: extracted.owner,
		};
		const matches = candidates.filter((candidate) =>
			applicationMatchesPreviewWebhook(candidate, context),
		);

		return {
			provider,
			applicationIds: matches.map((match) => match.applicationId),
			branch: extracted.branch,
			type: "pull_request",
			pullRequest: extracted.pullRequest,
			commit: extracted.pullRequest.headCommit
				? { sha: extracted.pullRequest.headCommit, message: null, author: null }
				: undefined,
		};
	}

	if (!extracted.branch) {
		throw new WebhookIgnored("webhook carried no branch");
	}

	// Candidates pre-filtered in SQL (same provider, auto-deploy on, and —
	// when the webhook URL names one — linked to that provider row); the
	// repo/branch/watch-path match itself runs in JS through the pure,
	// tested `applicationMatchesWebhook`.
	const conditions = [eq(applications.sourceType, provider), eq(applications.autoDeploy, true)];
	if (providerId) {
		conditions.push(eq(PROVIDER_COLUMN[provider], providerId));
	}
	const candidates = await db
		.select({
			applicationId: applications.applicationId,
			sourceType: applications.sourceType,
			repository: applications.repository,
			owner: applications.owner,
			branch: applications.branch,
			autoDeploy: applications.autoDeploy,
			watchPaths: applications.watchPaths,
		})
		.from(applications)
		.where(and(...conditions));

	const context: WebhookRepoContext = { provider, ...extracted };
	const matches = candidates.filter((candidate) => applicationMatchesWebhook(candidate, context));

	return {
		provider,
		applicationIds: matches.map((match) => match.applicationId),
		branch: extracted.branch,
		type: extracted.type,
		commit: extracted.commit,
	};
}

/** Deployment provenance of a verified provider delivery: `webhook:<provider>` + head commit. */
export function webhookProvenance(
	result: Pick<GitWebhookResult, "provider" | "commit">,
): DeploymentProvenance {
	return {
		trigger: "webhook",
		triggeredBy: `webhook:${result.provider}`,
		commitSha: result.commit?.sha ?? null,
		commitMessage: result.commit?.message ?? null,
		commitAuthor: result.commit?.author ?? null,
	};
}

/**
 * Enqueue a redeploy triggered by a webhook with a descriptive title
 * ("Webhook: push to main") and its provenance. Defaults to a provider
 * `webhook` trigger; the generic API-key deploy hook passes `api` + user.
 */
export async function queueWebhookDeployment(
	applicationId: string,
	title: string,
	provenance: Partial<DeploymentProvenance> = {},
): Promise<string> {
	return await queueDeployment({
		applicationId,
		type: "redeploy",
		title,
		trigger: "webhook",
		...provenance,
	});
}
