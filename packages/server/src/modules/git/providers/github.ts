import { Webhooks } from "@octokit/webhooks";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { github } from "../../../db/schema";
import { isForkPullRequest } from "../../preview/fork-gate";
import {
	asString,
	collectCommitPaths,
	commitUrlFromRepoHtml,
	type ExtractedWebhook,
	extractPushCommit,
	header,
	normalizeRef,
	type WebhookHeaders,
	WebhookIgnored,
	WebhookUnauthorized,
} from "./shared";

/** Verify a GitHub delivery and normalize its push / pull_request payload. */
export async function verifyAndExtractGithub(
	headers: WebhookHeaders,
	rawBody: string,
	providerId?: string,
): Promise<ExtractedWebhook> {
	const event = header(headers, "x-github-event") ?? "";
	const signature = header(headers, "x-hub-signature-256") ?? "";

	// Verify the signature against every configured github app; the first
	// matching secret wins (an instance can host several GitHub Apps). When
	// the webhook URL names a provider, only that row's secret is accepted.
	const rows = providerId
		? await db.select().from(github).where(eq(github.githubId, providerId))
		: await db.select().from(github);
	if (providerId && rows.length === 0) {
		throw new WebhookUnauthorized(`unknown github provider: ${providerId}`);
	}
	let verified = false;
	for (const row of rows) {
		if (!row.githubWebhookSecret) continue;
		const webhooks = new Webhooks({ secret: row.githubWebhookSecret });
		if (await webhooks.verify(rawBody, signature)) {
			verified = true;
			break;
		}
	}
	if (!verified) {
		throw new WebhookUnauthorized("github signature verification failed");
	}

	if (event === "ping") {
		throw new WebhookIgnored("github ping event");
	}

	const payload = JSON.parse(rawBody);
	if (event === "push") {
		const { branch, isTag } = normalizeRef(payload.ref);
		const fullName: string = payload.repository?.full_name ?? "";
		const [owner = "", repository = ""] = fullName.split("/");
		return {
			branch,
			type: isTag ? "tag" : "push",
			repository,
			owner,
			cloneUrl: payload.repository?.clone_url,
			changedPaths: collectCommitPaths(payload.commits),
			commit: extractPushCommit(payload.after, payload.head_commit, payload.pusher?.name),
		};
	}
	if (event === "pull_request") {
		const fullName: string = payload.repository?.full_name ?? "";
		const [owner = "", repository = ""] = fullName.split("/");
		const pr = payload.pull_request ?? {};
		return {
			branch: pr.head?.ref ?? "",
			type: "pull_request",
			repository,
			owner,
			pullRequest: {
				action: asString(payload.action),
				number: asString(pr.number ?? payload.number),
				id: asString(pr.id) || null,
				title: typeof pr.title === "string" ? pr.title : null,
				url: typeof pr.html_url === "string" ? pr.html_url : null,
				isFork: isForkPullRequest({
					headRepoFullName:
						typeof pr.head?.repo?.full_name === "string" ? pr.head.repo.full_name : null,
					baseRepoFullName: fullName || null,
					headRepoForkFlag: typeof pr.head?.repo?.fork === "boolean" ? pr.head.repo.fork : null,
				}),
				headRepoFullName:
					typeof pr.head?.repo?.full_name === "string" ? pr.head.repo.full_name : null,
				headCommit: typeof pr.head?.sha === "string" ? pr.head.sha : null,
				// GitHub's pull_request payload carries the head sha but never
				// the head commit's message or author, so only the URL can be
				// built here (from the head repository, which is the fork for
				// fork PRs — that is where the commit actually lives).
				headCommitMessage: null,
				headCommitAuthor: null,
				headCommitUrl: commitUrlFromRepoHtml(pr.head?.repo?.html_url, pr.head?.sha),
				authorLogin: typeof pr.user?.login === "string" ? pr.user.login : null,
			},
		};
	}
	throw new WebhookIgnored(`unsupported github event: ${event}`);
}
