import { eq } from "drizzle-orm";
import { db } from "../../db";
import { bitbucket, deployments, gitea, github, gitlab, previewDeployments } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { providerJsonFetch } from "./comment";
import { withPreviewDomain } from "./index";
import { loadPreviewParentForPreview } from "./parent";

/**
 * Commit statuses for previews: the check on the commit itself ("preview
 * deploying / live / failed") next to the PR comment. A status is what the
 * provider's merge box, the branch page and a reviewer's notification read;
 * a comment is only what a human scrolls to.
 *
 * Posted for pull-request AND branch previews — a status hangs off a commit,
 * not a PR — whenever the commit is known: from the webhook payload up front,
 * or from the checkout once the build has run (`deployment.commitSha`). Best
 * effort throughout: a provider without credentials or a failed API call
 * never fails the deploy that triggered it.
 */

const log = createLogger("preview-status");

export type PreviewCommitState = "pending" | "success" | "failure";

/** The context/name every provider shows next to the status. */
export const PREVIEW_STATUS_CONTEXT = "nixploy/preview";

export interface PreviewStatusPayload {
	state: string;
	targetUrl: string | null;
	description: string;
}

/** What each provider's API wants — the pure part, tested on its own. */
export function providerStatusPayload(
	provider: "github" | "gitea" | "gitlab" | "bitbucket",
	input: PreviewStatusPayload,
): Record<string, unknown> {
	switch (provider) {
		case "github":
		case "gitea":
			return {
				state: input.state,
				target_url: input.targetUrl ?? undefined,
				description: input.description.slice(0, 140),
				context: PREVIEW_STATUS_CONTEXT,
			};
		case "gitlab":
			return {
				state: input.state === "failure" ? "failed" : input.state,
				name: PREVIEW_STATUS_CONTEXT,
				target_url: input.targetUrl ?? undefined,
				description: input.description.slice(0, 255),
			};
		case "bitbucket":
			return {
				state:
					input.state === "pending"
						? "INPROGRESS"
						: input.state === "success"
							? "SUCCESSFUL"
							: "FAILED",
				key: PREVIEW_STATUS_CONTEXT,
				name: "Nixploy preview",
				url: input.targetUrl ?? undefined,
				description: input.description.slice(0, 255),
			};
	}
}

/** The line the reviewer reads, and where the status links. */
export function describePreviewState(
	state: PreviewCommitState,
	hosts: readonly { host: string; https: boolean }[],
): PreviewStatusPayload {
	const first = hosts[0] ?? null;
	const targetUrl = first ? `${first.https ? "https" : "http"}://${first.host}` : null;
	const description =
		state === "pending"
			? "Nixploy is building the preview"
			: state === "success"
				? first
					? `Preview is live at ${first.host}`
					: "Preview is live"
				: "Preview build failed";
	return { state, targetUrl, description };
}

export interface ReportPreviewCommitStatusInput {
	previewDeploymentId: string;
	state: PreviewCommitState;
	/** The deployment whose checkout resolved the commit, when the preview row does not know it. */
	deploymentId?: string | null;
}

/** Post the status. Returns whether something was sent. */
export async function reportPreviewCommitStatus(
	input: ReportPreviewCommitStatusInput,
): Promise<boolean> {
	try {
		const row = await db.query.previewDeployments.findFirst({
			where: eq(previewDeployments.previewDeploymentId, input.previewDeploymentId),
		});
		if (!row) return false;
		const parent = await loadPreviewParentForPreview(row);
		if (!parent?.owner || !parent.repository) return false;

		let sha = row.commitSha ?? null;
		if (!sha && input.deploymentId) {
			const deployment = await db.query.deployments.findFirst({
				where: eq(deployments.deploymentId, input.deploymentId),
				columns: { commitSha: true },
			});
			sha = deployment?.commitSha ?? null;
		}
		if (!sha || !/^[0-9a-f]{7,64}$/i.test(sha)) return false;

		const preview = await withPreviewDomain(row);
		const payload = describePreviewState(input.state, preview.domains);

		switch (parent.sourceType) {
			case "github": {
				if (!parent.githubId) return false;
				const [provider] = await db
					.select()
					.from(github)
					.where(eq(github.githubId, parent.githubId))
					.limit(1);
				if (!provider) return false;
				// Lazily: the Octokit packages are ESM-only and this module sits on
				// the worker's boot path through the deploy worker; a static import
				// here crashed both roles at start (CI, 2026-09-20).
				const { getGithubOctokit } = await import("../git/github");
				const octokit = getGithubOctokit(provider);
				const body = providerStatusPayload("github", payload);
				await octokit.rest.repos.createCommitStatus({
					owner: parent.owner,
					repo: parent.repository,
					sha,
					state: input.state,
					target_url: typeof body.target_url === "string" ? body.target_url : undefined,
					description: String(body.description),
					context: PREVIEW_STATUS_CONTEXT,
				});
				return true;
			}
			case "gitlab": {
				if (!parent.gitlabId) return false;
				const [provider] = await db
					.select()
					.from(gitlab)
					.where(eq(gitlab.gitlabId, parent.gitlabId))
					.limit(1);
				if (!provider?.accessToken) return false;
				const base = provider.gitlabUrl.replace(/\/$/, "");
				const project = encodeURIComponent(`${parent.owner}/${parent.repository}`);
				await providerJsonFetch(`${base}/api/v4/projects/${project}/statuses/${sha}`, {
					method: "POST",
					token: provider.accessToken,
					tokenScheme: "PRIVATE-TOKEN",
					body: JSON.stringify(providerStatusPayload("gitlab", payload)),
				});
				return true;
			}
			case "gitea": {
				if (!parent.giteaId) return false;
				const [provider] = await db
					.select()
					.from(gitea)
					.where(eq(gitea.giteaId, parent.giteaId))
					.limit(1);
				if (!provider?.accessToken) return false;
				const base = provider.giteaUrl.replace(/\/$/, "");
				await providerJsonFetch(
					`${base}/api/v1/repos/${parent.owner}/${parent.repository}/statuses/${sha}`,
					{
						method: "POST",
						token: provider.accessToken,
						tokenScheme: "token",
						body: JSON.stringify(providerStatusPayload("gitea", payload)),
					},
				);
				return true;
			}
			case "bitbucket": {
				if (!parent.bitbucketId) return false;
				const [provider] = await db
					.select()
					.from(bitbucket)
					.where(eq(bitbucket.bitbucketId, parent.bitbucketId))
					.limit(1);
				if (!provider?.bitbucketUsername || !provider.appPassword) return false;
				// The build-status endpoint takes the repository's own app password;
				// the comment API needs a workspace token, which is why comments are
				// not posted on Bitbucket while statuses are.
				const basic = Buffer.from(`${provider.bitbucketUsername}:${provider.appPassword}`).toString(
					"base64",
				);
				await providerJsonFetch(
					`https://api.bitbucket.org/2.0/repositories/${parent.owner}/${parent.repository}/commit/${sha}/statuses/build`,
					{
						method: "POST",
						token: basic,
						tokenScheme: "Basic",
						body: JSON.stringify(providerStatusPayload("bitbucket", payload)),
					},
				);
				return true;
			}
			default:
				return false;
		}
	} catch (error) {
		log.warn("Could not post the preview commit status", {
			previewDeploymentId: input.previewDeploymentId,
			state: input.state,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}
