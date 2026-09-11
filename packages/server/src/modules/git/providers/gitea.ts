import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { gitea } from "../../../db/schema";
import { isForkPullRequest } from "../../preview/fork-gate";
import { derivedWebhookSecret } from "../webhook-secret";
import {
	asString,
	collectCommitPaths,
	type ExtractedWebhook,
	extractPushCommit,
	header,
	normalizeRef,
	safeEqual,
	type WebhookHeaders,
	WebhookIgnored,
	WebhookUnauthorized,
} from "./shared";

/** Verify a Gitea delivery and normalize its push / pull_request payload. */
export async function verifyAndExtractGitea(
	headers: WebhookHeaders,
	rawBody: string,
	providerId?: string,
): Promise<ExtractedWebhook> {
	// Gitea signs the body with HMAC-SHA256 using the webhook secret. We use a
	// dedicated derived secret (never the API access token). When the webhook
	// URL names a provider, that row must exist. A missing signature is rejected.
	const signature = header(headers, "x-gitea-signature");
	if (providerId) {
		const rows = await db.select().from(gitea).where(eq(gitea.giteaId, providerId));
		if (rows.length === 0) {
			throw new WebhookUnauthorized(`unknown gitea provider: ${providerId}`);
		}
		if (!signature) {
			throw new WebhookUnauthorized("missing gitea signature");
		}
		const secret = derivedWebhookSecret("gitea", providerId);
		const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
		if (!safeEqual(digest, signature)) {
			throw new WebhookUnauthorized("gitea signature mismatch");
		}
	} else if (signature) {
		const rows = await db.select().from(gitea);
		const authorized = rows.some((row) => {
			const secret = derivedWebhookSecret("gitea", row.giteaId);
			const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
			return safeEqual(digest, signature);
		});
		if (!authorized) {
			throw new WebhookUnauthorized("gitea signature mismatch");
		}
	} else {
		throw new WebhookUnauthorized("missing gitea signature");
	}

	const payload = JSON.parse(rawBody);
	const event = header(headers, "x-gitea-event") ?? "";
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
			commit: extractPushCommit(
				payload.after,
				payload.head_commit,
				payload.pusher?.full_name ?? payload.pusher?.login ?? payload.pusher?.username,
			),
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
				authorLogin: typeof pr.user?.login === "string" ? pr.user.login : null,
			},
		};
	}
	throw new WebhookIgnored(`unsupported gitea event: ${event}`);
}
