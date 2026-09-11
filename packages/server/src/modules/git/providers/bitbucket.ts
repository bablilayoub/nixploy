import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { bitbucket } from "../../../db/schema";
import { isForkPullRequest } from "../../preview/fork-gate";
import { derivedWebhookSecret } from "../webhook-secret";
import {
	asString,
	commitUrlFromRepoHtml,
	type ExtractedWebhook,
	extractPushCommit,
	header,
	optionalString,
	safeEqual,
	type WebhookHeaders,
	WebhookIgnored,
	WebhookUnauthorized,
} from "./shared";

/** Verify a Bitbucket delivery and normalize its push / pullrequest payload. */
export async function verifyAndExtractBitbucket(
	headers: WebhookHeaders,
	rawBody: string,
	providerId?: string,
): Promise<ExtractedWebhook> {
	// Bitbucket Cloud has no standard HMAC for all plans. Require a Bearer token
	// matching the dedicated derived webhook secret (never the API token / app
	// password). Configure Authorization: Bearer <webhookSecret> in Bitbucket.
	if (providerId) {
		const rows = await db.select().from(bitbucket).where(eq(bitbucket.bitbucketId, providerId));
		if (rows.length === 0) {
			throw new WebhookUnauthorized(`unknown bitbucket provider: ${providerId}`);
		}
		const expected = derivedWebhookSecret("bitbucket", providerId);
		const auth = header(headers, "authorization") ?? "";
		const presented = auth.replace(/^Bearer\s+/i, "").trim();
		if (!presented || !safeEqual(presented, expected)) {
			throw new WebhookUnauthorized("bitbucket webhook authorization failed");
		}
	} else {
		throw new WebhookUnauthorized("bitbucket webhooks require a provider id in the URL");
	}
	const event = header(headers, "x-event-key") ?? "";
	const payload = JSON.parse(rawBody);
	if (event === "repo:push") {
		const change = payload.push?.changes?.[0];
		const newRef = change?.new;
		const commit = extractPushCommit(
			newRef?.target?.hash,
			newRef?.target,
			payload.actor?.display_name ?? payload.actor?.nickname,
		);
		if (newRef?.type === "tag") {
			return {
				branch: newRef.name ?? "",
				type: "tag",
				repository: payload.repository?.name ?? "",
				owner: payload.repository?.workspace?.slug ?? "",
				commit,
			};
		}
		return {
			branch: newRef?.name ?? "",
			type: "push",
			repository: payload.repository?.name ?? "",
			owner: payload.repository?.workspace?.slug ?? "",
			cloneUrl: payload.repository?.links?.html?.href,
			commit,
		};
	}
	const prEvents: Record<string, string> = {
		"pullrequest:created": "created",
		"pullrequest:updated": "updated",
		"pullrequest:fulfilled": "fulfilled",
		"pullrequest:rejected": "rejected",
	};
	if (event in prEvents) {
		const pr = payload.pullrequest ?? {};
		const baseFullName: string = payload.repository?.full_name ?? "";
		const headFullName: string = pr.source?.repository?.full_name ?? "";
		return {
			branch: pr.source?.branch?.name ?? "",
			type: "pull_request",
			repository: payload.repository?.name ?? "",
			owner: payload.repository?.workspace?.slug ?? "",
			pullRequest: {
				action: prEvents[event] ?? event,
				number: asString(pr.id),
				id: asString(pr.id) || null,
				title: typeof pr.title === "string" ? pr.title : null,
				url: typeof pr.links?.html?.href === "string" ? pr.links.html.href : null,
				isFork: isForkPullRequest({
					headRepoFullName: headFullName || null,
					baseRepoFullName: baseFullName || null,
				}),
				headRepoFullName: headFullName || null,
				headCommit: typeof pr.source?.commit?.hash === "string" ? pr.source.commit.hash : null,
				// Bitbucket sends the source commit's hash and, on most plans,
				// an `html` link for it; `message`/`author` are only on the
				// `repo:push` payload, never on a pullrequest one. The fallback
				// builds `<repo html>/commits/<hash>` — Bitbucket's plural path.
				headCommitMessage: null,
				headCommitAuthor: null,
				headCommitUrl:
					optionalString(pr.source?.commit?.links?.html?.href) ??
					commitUrlFromRepoHtml(
						pr.source?.repository?.links?.html?.href,
						pr.source?.commit?.hash,
						"commits",
					),
				authorLogin: typeof pr.author?.nickname === "string" ? pr.author.nickname : null,
			},
		};
	}
	throw new WebhookIgnored(`unsupported bitbucket event: ${event}`);
}
