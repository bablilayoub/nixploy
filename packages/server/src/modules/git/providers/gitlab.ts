import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { gitlab } from "../../../db/schema";
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

/** GitLab MR `update` events without `object_attributes.oldrev` did not push code. */
export function isGitlabMetadataOnlyUpdate(action: string, oldrev: unknown): boolean {
	return action.toLowerCase() === "update" && !(typeof oldrev === "string" && oldrev.length > 0);
}

/** Verify a GitLab delivery and normalize its push / merge_request payload. */
export async function verifyAndExtractGitlab(
	headers: WebhookHeaders,
	rawBody: string,
	providerId?: string,
): Promise<ExtractedWebhook> {
	// GitLab signs webhooks with a shared secret token. Any configured gitlab
	// row whose `secret` matches the X-Gitlab-Token header authorizes the call.
	// When the webhook URL names a provider, that row must exist and its
	// secret must match — a provider without a secret cannot be triggered,
	// since accepting it would make the endpoint an open deploy trigger.
	const token = header(headers, "x-gitlab-token");
	if (providerId) {
		const rows = await db.select().from(gitlab).where(eq(gitlab.gitlabId, providerId));
		const row = rows[0];
		if (!row) {
			throw new WebhookUnauthorized(`unknown gitlab provider: ${providerId}`);
		}
		if (!row.secret) {
			throw new WebhookUnauthorized("gitlab provider has no webhook secret configured");
		}
		if (!token || !safeEqual(row.secret, token)) {
			throw new WebhookUnauthorized("gitlab token mismatch");
		}
	} else if (token) {
		const rows = await db.select().from(gitlab);
		const authorized = rows.some((row) => row.secret && safeEqual(row.secret, token));
		if (!authorized) {
			throw new WebhookUnauthorized("gitlab token mismatch");
		}
	} else {
		throw new WebhookUnauthorized("missing gitlab token");
	}

	const payload = JSON.parse(rawBody);
	const event: string = payload.object_kind ?? "";
	if (event === "push" || event === "tag_push") {
		const { branch } = normalizeRef(payload.ref);
		const pathWithNamespace: string = payload.project?.path_with_namespace ?? "";
		const parts = pathWithNamespace.split("/");
		const commits = Array.isArray(payload.commits) ? payload.commits : [];
		return {
			branch,
			type: event === "tag_push" ? "tag" : "push",
			repository: parts[parts.length - 1] ?? "",
			owner: parts.slice(0, -1).join("/"),
			cloneUrl: payload.project?.git_http_url,
			changedPaths: collectCommitPaths(payload.commits),
			// GitLab lists commits oldest-first; `checkout_sha` is the head.
			commit: extractPushCommit(
				payload.checkout_sha ?? payload.after,
				commits[commits.length - 1],
				payload.user_name ?? payload.user_username,
			),
		};
	}
	if (event === "merge_request") {
		const pathWithNamespace: string = payload.project?.path_with_namespace ?? "";
		const parts = pathWithNamespace.split("/");
		const attrs = payload.object_attributes ?? {};
		const action = asString(attrs.action);
		// GitLab fires `update` for title/description/label/reviewer edits as
		// well as for pushes; only a push carries `oldrev`. Rebuilding on every
		// label change turns label-heavy workflows into build storms.
		if (isGitlabMetadataOnlyUpdate(action, attrs.oldrev)) {
			throw new WebhookIgnored("gitlab merge_request update without oldrev (metadata only)");
		}
		return {
			branch: attrs.source_branch ?? "",
			type: "pull_request",
			repository: parts[parts.length - 1] ?? "",
			owner: parts.slice(0, -1).join("/"),
			pullRequest: {
				action,
				number: asString(attrs.iid ?? attrs.id),
				id: asString(attrs.id) || null,
				title: typeof attrs.title === "string" ? attrs.title : null,
				url: typeof attrs.url === "string" ? attrs.url : null,
				isFork:
					attrs.source_project_id != null &&
					attrs.target_project_id != null &&
					attrs.source_project_id !== attrs.target_project_id,
				headRepoFullName:
					typeof attrs.source?.path_with_namespace === "string"
						? attrs.source.path_with_namespace
						: null,
				headCommit: typeof attrs.last_commit?.id === "string" ? attrs.last_commit.id : null,
				authorLogin: typeof payload.user?.username === "string" ? payload.user.username : null,
			},
		};
	}
	throw new WebhookIgnored(`unsupported gitlab event: ${event}`);
}
