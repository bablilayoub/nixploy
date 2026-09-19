import { eq } from "drizzle-orm";
import { db } from "../../db";
import { gitea, github, gitlab } from "../../db/schema";
import { getGithubOctokit } from "../git/github";
import { listComposeExposedServices } from "./compose";
import { previewComposeHost, previewHost } from "./naming";
import { loadPreviewParent, type PreviewParentRef } from "./parent";
import { providerJsonFetch } from "./provider-fetch";

/**
 * Hidden marker kept in the comment body so repeated pushes to the same pull
 * request edit one comment instead of appending a new one every time.
 */
export const PREVIEW_COMMENT_MARKER = "<!-- nixploy-preview -->";

export type PreviewCommentStatus = "deploying" | "removed" | "awaiting_approval" | "limit_reached";

export type RenderPreviewCommentInput = {
	pullRequestNumber: string;
	/**
	 * Every host the preview answers on: one for an application, one per
	 * exposed compose service for a compose stack (possibly none, when no
	 * compose service has a production domain to mirror).
	 */
	hosts: string[];
	status: PreviewCommentStatus;
};

/** Markdown body posted back to the pull request. */
export function renderPreviewComment({
	pullRequestNumber,
	hosts,
	status,
}: RenderPreviewCommentInput): string {
	if (status === "removed") {
		return [
			PREVIEW_COMMENT_MARKER,
			"### Nixploy preview removed",
			"",
			`The preview environment for PR #${pullRequestNumber} has been torn down.`,
		].join("\n");
	}
	if (status === "limit_reached") {
		return [
			PREVIEW_COMMENT_MARKER,
			"### Nixploy preview not created",
			"",
			`This application has reached its preview limit, so no preview was built for PR #${pullRequestNumber}.`,
			"",
			"Close or delete another preview, or raise the limit on the application's Previews tab.",
		].join("\n");
	}
	if (status === "awaiting_approval") {
		return [
			PREVIEW_COMMENT_MARKER,
			"### Nixploy preview awaiting approval",
			"",
			`This pull request comes from a fork, so the preview for PR #${pullRequestNumber} was not built automatically.`,
			"",
			"A maintainer can approve the preview from the Nixploy dashboard.",
		].join("\n");
	}
	if (hosts.length === 0) {
		return [
			PREVIEW_COMMENT_MARKER,
			"### Nixploy preview",
			"",
			`The preview environment for PR #${pullRequestNumber} is deploying. It has no public URL — no service in this stack has a domain yet.`,
		].join("\n");
	}
	return [
		PREVIEW_COMMENT_MARKER,
		"### Nixploy preview",
		"",
		`| Preview | Pull request |`,
		`| --- | --- |`,
		...hosts.map((host) => `| https://${host} | #${pullRequestNumber} |`),
		"",
		hosts.length > 1
			? "The preview is deploying — the URLs respond once the deployment finishes."
			: "The preview is deploying — the URL responds once the deployment finishes.",
	].join("\n");
}

type ExistingComment = { id: number | string; body: string };

/** Pick the comment we previously wrote, identified by the hidden marker. */
function findOwnComment(comments: ExistingComment[]): ExistingComment | undefined {
	return comments.find((comment) => comment.body?.includes(PREVIEW_COMMENT_MARKER));
}

async function commentOnGithub(input: {
	githubId: string;
	owner: string;
	repo: string;
	pullRequestNumber: string;
	body: string;
}): Promise<void> {
	const [row] = await db.select().from(github).where(eq(github.githubId, input.githubId)).limit(1);
	if (!row) throw new Error(`GitHub provider not found: ${input.githubId}`);
	const octokit = getGithubOctokit(row);
	const issueNumber = Number(input.pullRequestNumber);
	const { data } = await octokit.rest.issues.listComments({
		owner: input.owner,
		repo: input.repo,
		issue_number: issueNumber,
		per_page: 100,
	});
	const existing = findOwnComment(
		data.map((comment) => ({ id: comment.id, body: comment.body ?? "" })),
	);
	if (existing) {
		await octokit.rest.issues.updateComment({
			owner: input.owner,
			repo: input.repo,
			comment_id: Number(existing.id),
			body: input.body,
		});
		return;
	}
	await octokit.rest.issues.createComment({
		owner: input.owner,
		repo: input.repo,
		issue_number: issueNumber,
		body: input.body,
	});
}

async function commentOnGitlab(input: {
	gitlabId: string;
	owner: string;
	repo: string;
	pullRequestNumber: string;
	body: string;
}): Promise<void> {
	const [row] = await db.select().from(gitlab).where(eq(gitlab.gitlabId, input.gitlabId)).limit(1);
	if (!row?.accessToken) throw new Error("GitLab provider has no access token");
	const base = row.gitlabUrl.replace(/\/$/, "");
	const project = encodeURIComponent(`${input.owner}/${input.repo}`);
	const notesUrl = `${base}/api/v4/projects/${project}/merge_requests/${input.pullRequestNumber}/notes`;
	const notes = (await providerJsonFetch(`${notesUrl}?per_page=100`, {
		token: row.accessToken,
		tokenScheme: "PRIVATE-TOKEN",
	})) as { id: number; body?: string }[] | null;
	const existing = findOwnComment(
		(notes ?? []).map((note) => ({ id: note.id, body: note.body ?? "" })),
	);
	await providerJsonFetch(existing ? `${notesUrl}/${existing.id}` : notesUrl, {
		method: existing ? "PUT" : "POST",
		token: row.accessToken,
		tokenScheme: "PRIVATE-TOKEN",
		body: JSON.stringify({ body: input.body }),
	});
}

async function commentOnGitea(input: {
	giteaId: string;
	owner: string;
	repo: string;
	pullRequestNumber: string;
	body: string;
}): Promise<void> {
	const [row] = await db.select().from(gitea).where(eq(gitea.giteaId, input.giteaId)).limit(1);
	if (!row?.accessToken) throw new Error("Gitea provider has no access token");
	const base = row.giteaUrl.replace(/\/$/, "");
	const repoApi = `${base}/api/v1/repos/${input.owner}/${input.repo}`;
	const comments = (await providerJsonFetch(
		`${repoApi}/issues/${input.pullRequestNumber}/comments?limit=100`,
		{ token: row.accessToken, tokenScheme: "token" },
	)) as { id: number; body?: string }[] | null;
	const existing = findOwnComment(
		(comments ?? []).map((comment) => ({ id: comment.id, body: comment.body ?? "" })),
	);
	if (existing) {
		await providerJsonFetch(`${repoApi}/issues/comments/${existing.id}`, {
			method: "PATCH",
			token: row.accessToken,
			tokenScheme: "token",
			body: JSON.stringify({ body: input.body }),
		});
		return;
	}
	await providerJsonFetch(`${repoApi}/issues/${input.pullRequestNumber}/comments`, {
		method: "POST",
		token: row.accessToken,
		tokenScheme: "token",
		body: JSON.stringify({ body: input.body }),
	});
}

/**
 * Post (or edit) the preview URL comment on the pull request that triggered
 * the preview. Best effort: a provider without API credentials, or an API
 * failure, must never fail the webhook that queued the deployment.
 *
 * Bitbucket is intentionally unsupported — its comment API needs a workspace
 * level token Nixploy does not request.
 */
export async function upsertPreviewComment(
	input: PreviewParentRef & {
		pullRequestNumber: string;
		status: PreviewCommentStatus;
		/** Preview hosts; derived from the parent row when omitted. */
		hosts?: string[];
	},
): Promise<boolean> {
	try {
		const parent = await loadPreviewParent(input);
		if (!parent?.owner || !parent.repository) return false;

		// Deterministic from appName + PR number (+ the parent's exposed compose
		// services), so it also resolves after the preview row is gone — which
		// is exactly when the "removed" comment is rendered.
		const hosts =
			input.hosts ??
			(parent.kind === "application"
				? [previewHost(parent.appName, input.pullRequestNumber)]
				: (await listComposeExposedServices(parent.id)).map((service) =>
						previewComposeHost(parent.appName, input.pullRequestNumber, service.serviceName),
					));

		const body = renderPreviewComment({
			pullRequestNumber: input.pullRequestNumber,
			hosts,
			status: input.status,
		});
		const shared = {
			owner: parent.owner,
			repo: parent.repository,
			pullRequestNumber: input.pullRequestNumber,
			body,
		};

		switch (parent.sourceType) {
			case "github":
				if (!parent.githubId) return false;
				await commentOnGithub({ ...shared, githubId: parent.githubId });
				return true;
			case "gitlab":
				if (!parent.gitlabId) return false;
				await commentOnGitlab({ ...shared, gitlabId: parent.gitlabId });
				return true;
			case "gitea":
				if (!parent.giteaId) return false;
				await commentOnGitea({ ...shared, giteaId: parent.giteaId });
				return true;
			default:
				return false;
		}
	} catch (error) {
		console.error(
			`Failed to comment the preview URL on PR #${input.pullRequestNumber}:`,
			error instanceof Error ? error.message : error,
		);
		return false;
	}
}
