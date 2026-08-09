import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, gitea, github, gitlab } from "../../db/schema";
import { getGithubOctokit } from "../git/github";
import { previewHost } from "./index";

/**
 * Hidden marker kept in the comment body so repeated pushes to the same pull
 * request edit one comment instead of appending a new one every time.
 */
export const PREVIEW_COMMENT_MARKER = "<!-- nixploy-preview -->";

export type PreviewCommentStatus = "deploying" | "removed" | "awaiting_approval";

export type RenderPreviewCommentInput = {
	pullRequestNumber: string;
	host: string;
	status: PreviewCommentStatus;
};

/** Markdown body posted back to the pull request. */
export function renderPreviewComment({
	pullRequestNumber,
	host,
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
	return [
		PREVIEW_COMMENT_MARKER,
		"### Nixploy preview",
		"",
		`| Preview | Pull request |`,
		`| --- | --- |`,
		`| https://${host} | #${pullRequestNumber} |`,
		"",
		"The preview is deploying — the URL responds once the deployment finishes.",
	].join("\n");
}

type ExistingComment = { id: number | string; body: string };

/** Pick the comment we previously wrote, identified by the hidden marker. */
function findOwnComment(comments: ExistingComment[]): ExistingComment | undefined {
	return comments.find((comment) => comment.body?.includes(PREVIEW_COMMENT_MARKER));
}

async function jsonFetch(
	url: string,
	init: RequestInit & { token: string; tokenScheme?: "Bearer" | "token" | "PRIVATE-TOKEN" },
): Promise<unknown> {
	const { token, tokenScheme = "Bearer", headers, ...rest } = init;
	const authHeaders: Record<string, string> =
		tokenScheme === "PRIVATE-TOKEN"
			? { "PRIVATE-TOKEN": token }
			: { Authorization: `${tokenScheme} ${token}` };
	const response = await fetch(url, {
		...rest,
		redirect: rest.redirect ?? "error",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			...authHeaders,
			...(headers as Record<string, string> | undefined),
		},
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	if (response.status === 204) return null;
	return await response.json().catch(() => null);
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
	const notes = (await jsonFetch(`${notesUrl}?per_page=100`, {
		token: row.accessToken,
		tokenScheme: "PRIVATE-TOKEN",
	})) as { id: number; body?: string }[] | null;
	const existing = findOwnComment(
		(notes ?? []).map((note) => ({ id: note.id, body: note.body ?? "" })),
	);
	await jsonFetch(existing ? `${notesUrl}/${existing.id}` : notesUrl, {
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
	const comments = (await jsonFetch(
		`${repoApi}/issues/${input.pullRequestNumber}/comments?limit=100`,
		{ token: row.accessToken, tokenScheme: "token" },
	)) as { id: number; body?: string }[] | null;
	const existing = findOwnComment(
		(comments ?? []).map((comment) => ({ id: comment.id, body: comment.body ?? "" })),
	);
	if (existing) {
		await jsonFetch(`${repoApi}/issues/comments/${existing.id}`, {
			method: "PATCH",
			token: row.accessToken,
			tokenScheme: "token",
			body: JSON.stringify({ body: input.body }),
		});
		return;
	}
	await jsonFetch(`${repoApi}/issues/${input.pullRequestNumber}/comments`, {
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
export async function upsertPreviewComment(input: {
	applicationId: string;
	pullRequestNumber: string;
	status: PreviewCommentStatus;
	/** Preview host; looked up from the preview's domain row when omitted. */
	host?: string;
}): Promise<boolean> {
	try {
		const application = await db.query.applications.findFirst({
			where: eq(applications.applicationId, input.applicationId),
			columns: {
				appName: true,
				sourceType: true,
				owner: true,
				repository: true,
				githubId: true,
				gitlabId: true,
				giteaId: true,
			},
		});
		if (!application?.owner || !application.repository) return false;

		// Deterministic from appName + PR number, so it also resolves after the
		// preview row is gone (the "removed" comment).
		const host = input.host ?? previewHost(application.appName, input.pullRequestNumber);

		const body = renderPreviewComment({
			pullRequestNumber: input.pullRequestNumber,
			host,
			status: input.status,
		});
		const shared = {
			owner: application.owner,
			repo: application.repository,
			pullRequestNumber: input.pullRequestNumber,
			body,
		};

		switch (application.sourceType) {
			case "github":
				if (!application.githubId) return false;
				await commentOnGithub({ ...shared, githubId: application.githubId });
				return true;
			case "gitlab":
				if (!application.gitlabId) return false;
				await commentOnGitlab({ ...shared, gitlabId: application.gitlabId });
				return true;
			case "gitea":
				if (!application.giteaId) return false;
				await commentOnGitea({ ...shared, giteaId: application.giteaId });
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
