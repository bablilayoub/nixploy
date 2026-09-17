import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose } from "../../db/schema";
import { type DeploymentProvenance, queueDeployment } from "../deployment";
import { classifyPullRequestAction } from "../preview";
import { previewSourceRefForPullRequest } from "../preview/source-ref";
import {
	applicationMatchesPreviewWebhook,
	serviceMatchesWebhook,
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

const COMPOSE_PROVIDER_COLUMN = {
	github: compose.githubId,
	gitlab: compose.gitlabId,
	bitbucket: compose.bitbucketId,
	gitea: compose.giteaId,
} as const;

/**
 * A verified delivery plus the compose services that should react to it.
 * `GitWebhookResult` predates compose previews and only carries
 * `applicationIds`; widening it here keeps the provider modules untouched.
 */
export type GitWebhookDispatch = GitWebhookResult & {
	/** Ids of compose services that should react to this delivery (pull requests only). */
	composeIds: string[];
};

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
 * Pull request → applications AND compose services with
 * isPreviewDeploymentsActive matching repo only.
 */
export async function handleGitWebhook(
	provider: GitWebhookProvider,
	headers: WebhookHeaders,
	body: string | object,
	providerId?: string,
): Promise<GitWebhookDispatch> {
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
		const composeConditions = [
			eq(compose.sourceType, provider),
			eq(compose.isPreviewDeploymentsActive, true),
		];
		if (providerId) {
			composeConditions.push(eq(COMPOSE_PROVIDER_COLUMN[provider], providerId));
		}
		const [candidates, composeCandidates] = await Promise.all([
			db
				.select({
					applicationId: applications.applicationId,
					sourceType: applications.sourceType,
					repository: applications.repository,
					owner: applications.owner,
					isPreviewDeploymentsActive: applications.isPreviewDeploymentsActive,
				})
				.from(applications)
				.where(and(...conditions)),
			db
				.select({
					composeId: compose.composeId,
					sourceType: compose.sourceType,
					repository: compose.repository,
					owner: compose.owner,
					isPreviewDeploymentsActive: compose.isPreviewDeploymentsActive,
				})
				.from(compose)
				.where(and(...composeConditions)),
		]);

		const context = {
			provider,
			repository: extracted.repository,
			owner: extracted.owner,
		};
		const matches = candidates.filter((candidate) =>
			applicationMatchesPreviewWebhook(candidate, context),
		);
		// Same pure predicate: a compose row carries the identical provider,
		// repository, owner and previews-enabled columns.
		const composeMatches = composeCandidates.filter((candidate) =>
			applicationMatchesPreviewWebhook(candidate, context),
		);

		return {
			provider,
			applicationIds: matches.map((match) => match.applicationId),
			composeIds: composeMatches.map((match) => match.composeId),
			branch: extracted.branch,
			type: "pull_request",
			pullRequest: extracted.pullRequest,
			commit: extracted.pullRequest.headCommit
				? {
						sha: extracted.pullRequest.headCommit,
						message: extracted.pullRequest.headCommitMessage ?? null,
						author: extracted.pullRequest.headCommitAuthor ?? null,
					}
				: undefined,
		};
	}

	if (!extracted.branch) {
		throw new WebhookIgnored("webhook carried no branch");
	}

	// Candidates pre-filtered in SQL (same provider, auto-deploy on, and —
	// when the webhook URL names one — linked to that provider row); the
	// repo/branch/watch-path match itself runs in JS through the pure,
	// tested `serviceMatchesWebhook`.
	const conditions = [eq(applications.sourceType, provider), eq(applications.autoDeploy, true)];
	if (providerId) {
		conditions.push(eq(PROVIDER_COLUMN[provider], providerId));
	}
	// A git-backed compose stack carries the same provider/repository/owner/
	// branch/autoDeploy/watchPaths columns, so it goes through the same
	// predicate. `raw` stacks have no repository and never match.
	const composeConditions = [eq(compose.sourceType, provider), eq(compose.autoDeploy, true)];
	if (providerId) {
		composeConditions.push(eq(COMPOSE_PROVIDER_COLUMN[provider], providerId));
	}
	const [candidates, composeCandidates] = await Promise.all([
		db
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
			.where(and(...conditions)),
		db
			.select({
				composeId: compose.composeId,
				sourceType: compose.sourceType,
				repository: compose.repository,
				owner: compose.owner,
				branch: compose.branch,
				autoDeploy: compose.autoDeploy,
				watchPaths: compose.watchPaths,
			})
			.from(compose)
			.where(and(...composeConditions)),
	]);

	const context: WebhookRepoContext = { provider, ...extracted };
	const matches = candidates.filter((candidate) => serviceMatchesWebhook(candidate, context));
	const composeMatches = composeCandidates.filter((candidate) =>
		serviceMatchesWebhook(candidate, context),
	);

	return {
		provider,
		applicationIds: matches.map((match) => match.applicationId),
		composeIds: composeMatches.map((match) => match.composeId),
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

/** The compose twin of `queueWebhookDeployment`. */
export async function queueWebhookComposeDeployment(
	composeId: string,
	title: string,
	provenance: Partial<DeploymentProvenance> = {},
): Promise<string> {
	return await queueDeployment({
		composeId,
		type: "redeploy",
		title,
		trigger: "webhook",
		...provenance,
	});
}
