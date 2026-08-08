import { createHmac, timingSafeEqual } from "node:crypto";
import { Webhooks } from "@octokit/webhooks";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, bitbucket, deployments, gitea, github, gitlab } from "../../db/schema";
import { queueDeployment } from "../deployment";
import {
	classifyPullRequestAction,
	createOrRedeployPreview,
	deletePreviewByPullRequest,
} from "../preview";
import { upsertPreviewComment } from "../preview/comment";
import { derivedWebhookSecret } from "./webhook-secret";

export type GitWebhookProvider = "github" | "gitlab" | "bitbucket" | "gitea";

export type PullRequestWebhookInfo = {
	action: string;
	number: string;
	id?: string | null;
	title?: string | null;
	url?: string | null;
};

export type GitWebhookResult = {
	/** Ids of applications that should react to this delivery. */
	applicationIds: string[];
	branch: string;
	/** Provider-native event kind, normalized: "push" | "pull_request" | "tag". */
	type: "push" | "pull_request" | "tag";
	/** Present when type is pull_request. */
	pullRequest?: PullRequestWebhookInfo;
};

type WebhookHeaders = Record<string, string | string[] | undefined>;

function header(headers: WebhookHeaders, name: string): string | undefined {
	const value = headers[name.toLowerCase()];
	return Array.isArray(value) ? value[0] : value;
}

function safeEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function normalizeRef(ref: string | undefined): { branch: string; isTag: boolean } {
	if (!ref) return { branch: "", isTag: false };
	if (ref.startsWith("refs/tags/")) return { branch: ref.slice("refs/tags/".length), isTag: true };
	if (ref.startsWith("refs/heads/"))
		return { branch: ref.slice("refs/heads/".length), isTag: false };
	return { branch: ref, isTag: false };
}

function asString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return "";
}

// ── provider-specific extraction ────────────────────────────────────────────

type ExtractedWebhook = {
	branch: string;
	type: GitWebhookResult["type"];
	repository: string; // repo name (no owner)
	owner: string; // owner / namespace
	cloneUrl?: string;
	/** Files touched by a push (added/modified/removed across commits). */
	changedPaths?: string[];
	pullRequest?: PullRequestWebhookInfo;
};

/** Collect added/modified/removed paths from a push event's commit list. */
function collectCommitPaths(commits: unknown): string[] | undefined {
	if (!Array.isArray(commits)) return undefined;
	const paths = new Set<string>();
	for (const commit of commits) {
		for (const key of ["added", "modified", "removed"] as const) {
			const list = (commit as Record<string, unknown> | null)?.[key];
			if (Array.isArray(list)) {
				for (const path of list) {
					if (typeof path === "string") paths.add(path);
				}
			}
		}
	}
	return [...paths];
}

async function verifyAndExtractGithub(
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
			},
		};
	}
	throw new WebhookIgnored(`unsupported github event: ${event}`);
}

async function verifyAndExtractGitlab(
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
	}

	const payload = JSON.parse(rawBody);
	const event: string = payload.object_kind ?? "";
	if (event === "push" || event === "tag_push") {
		const { branch } = normalizeRef(payload.ref);
		const pathWithNamespace: string = payload.project?.path_with_namespace ?? "";
		const parts = pathWithNamespace.split("/");
		return {
			branch,
			type: event === "tag_push" ? "tag" : "push",
			repository: parts[parts.length - 1] ?? "",
			owner: parts.slice(0, -1).join("/"),
			cloneUrl: payload.project?.git_http_url,
			changedPaths: collectCommitPaths(payload.commits),
		};
	}
	if (event === "merge_request") {
		const pathWithNamespace: string = payload.project?.path_with_namespace ?? "";
		const parts = pathWithNamespace.split("/");
		const attrs = payload.object_attributes ?? {};
		return {
			branch: attrs.source_branch ?? "",
			type: "pull_request",
			repository: parts[parts.length - 1] ?? "",
			owner: parts.slice(0, -1).join("/"),
			pullRequest: {
				action: asString(attrs.action),
				number: asString(attrs.iid ?? attrs.id),
				id: asString(attrs.id) || null,
				title: typeof attrs.title === "string" ? attrs.title : null,
				url: typeof attrs.url === "string" ? attrs.url : null,
			},
		};
	}
	throw new WebhookIgnored(`unsupported gitlab event: ${event}`);
}

async function verifyAndExtractBitbucket(
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
		if (newRef?.type === "tag") {
			return {
				branch: newRef.name ?? "",
				type: "tag",
				repository: payload.repository?.name ?? "",
				owner: payload.repository?.workspace?.slug ?? "",
			};
		}
		return {
			branch: newRef?.name ?? "",
			type: "push",
			repository: payload.repository?.name ?? "",
			owner: payload.repository?.workspace?.slug ?? "",
			cloneUrl: payload.repository?.links?.html?.href,
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
			},
		};
	}
	throw new WebhookIgnored(`unsupported bitbucket event: ${event}`);
}

async function verifyAndExtractGitea(
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
			},
		};
	}
	throw new WebhookIgnored(`unsupported gitea event: ${event}`);
}

export class WebhookUnauthorized extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebhookUnauthorized";
	}
}

/** Non-error signal for deliveries that are valid but carry no work. */
export class WebhookIgnored extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebhookIgnored";
	}
}

const PROVIDER_COLUMN = {
	github: applications.githubId,
	gitlab: applications.gitlabId,
	bitbucket: applications.bitbucketId,
	gitea: applications.giteaId,
} as const;

// ── pure repo→application matching (unit-tested) ─────────────────────────────

/** Subset of an application row relevant to push webhook matching. */
export interface WebhookApplicationCandidate {
	sourceType: string;
	repository: string | null;
	owner: string | null;
	branch: string | null;
	autoDeploy: boolean;
	watchPaths: string[] | null;
}

/** Subset of an application row relevant to preview (PR) webhook matching. */
export interface PreviewWebhookCandidate {
	sourceType: string;
	repository: string | null;
	owner: string | null;
	isPreviewDeploymentsActive: boolean;
}

/** Repo identity extracted from a verified webhook delivery. */
export interface WebhookRepoContext {
	provider: GitWebhookProvider;
	repository: string;
	owner: string;
	branch: string;
	changedPaths?: string[];
}

/** Tiny glob: `**` crosses directories, `*` and `?` stay within one segment. */
function globToRegExp(glob: string): RegExp {
	const source = glob
		.split("**")
		.map((part) =>
			part
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/\?/g, "[^/]"),
		)
		.join(".*");
	return new RegExp(`^${source}$`);
}

/**
 * Decide whether a delivery's changed files fall under an application's
 * watch paths:
 * - no watch paths configured → every change deploys;
 * - the provider sent no file list (Bitbucket, pull_request events) →
 *   deploy, the filter cannot be evaluated;
 * - otherwise at least one changed path must match a watch path: exact
 *   match, directory prefix (`src` covers `src/index.ts`), or glob.
 */
export const watchPathsMatch = (
	changedPaths: string[] | undefined,
	watchPaths: string[] | null | undefined,
): boolean => {
	const patterns = (watchPaths ?? [])
		.map((pattern) => pattern.trim().replace(/^\/+|\/+$/g, ""))
		.filter(Boolean);
	if (patterns.length === 0) return true;
	if (!changedPaths) return true;
	return changedPaths.some((changed) => {
		const normalized = changed.replace(/^\/+/, "");
		return patterns.some((pattern) => {
			if (normalized === pattern || normalized.startsWith(`${pattern}/`)) return true;
			if (pattern.includes("*") || pattern.includes("?")) {
				return globToRegExp(pattern).test(normalized);
			}
			return false;
		});
	});
};

/**
 * Pure repo→application match: same provider, repository and branch, owner
 * compared case-insensitively, auto-deploy enabled, and the delivery's
 * changed files passing the application's watch-path filter.
 */
export const applicationMatchesWebhook = (
	application: WebhookApplicationCandidate,
	webhook: WebhookRepoContext,
): boolean => {
	if (application.sourceType !== webhook.provider) return false;
	if (!application.autoDeploy) return false;
	if (!application.repository || application.repository !== webhook.repository) return false;
	if ((application.owner ?? "").toLowerCase() !== webhook.owner.toLowerCase()) return false;
	if (application.branch !== webhook.branch) return false;
	return watchPathsMatch(webhook.changedPaths, application.watchPaths);
};

/**
 * Pure repo→application match for preview deployments: same provider and
 * repository, owner case-insensitive, previews enabled. Branch is NOT
 * compared — PR head branches differ from the app's production branch.
 */
export const applicationMatchesPreviewWebhook = (
	application: PreviewWebhookCandidate,
	webhook: Pick<WebhookRepoContext, "provider" | "repository" | "owner">,
): boolean => {
	if (application.sourceType !== webhook.provider) return false;
	if (!application.isPreviewDeploymentsActive) return false;
	if (!application.repository || application.repository !== webhook.repository) return false;
	if ((application.owner ?? "").toLowerCase() !== webhook.owner.toLowerCase()) return false;
	return true;
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
			applicationIds: matches.map((match) => match.applicationId),
			branch: extracted.branch,
			type: "pull_request",
			pullRequest: extracted.pullRequest,
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
		applicationIds: matches.map((match) => match.applicationId),
		branch: extracted.branch,
		type: extracted.type,
	};
}

/**
 * Enqueue a redeploy triggered by a webhook and retitle the deployment row
 * (queueDeployment only writes "Deployment"/"Redeploy") so the trigger shows
 * up in the deployment history, e.g. "Webhook: push to main".
 */
export async function queueWebhookDeployment(
	applicationId: string,
	title: string,
): Promise<string> {
	const deploymentId = await queueDeployment({ applicationId, type: "redeploy" });
	await db.update(deployments).set({ title }).where(eq(deployments.deploymentId, deploymentId));
	return deploymentId;
}

/**
 * Apply a verified pull_request webhook to one application: create/redeploy
 * on open/sync, delete on close. Returns a short status string for the HTTP
 * response.
 */
export async function handlePreviewWebhookForApplication(
	applicationId: string,
	webhook: GitWebhookResult,
): Promise<{ action: string; previewDeploymentId?: string; deploymentId?: string }> {
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

	const result = await createOrRedeployPreview({
		applicationId,
		pullRequestNumber: pr.number,
		branch: webhook.branch || null,
		pullRequestId: pr.id ?? null,
		pullRequestTitle: pr.title ?? null,
		pullRequestURL: pr.url ?? null,
	});

	const title = `Preview: PR #${pr.number} (${result.action})`;
	if (result.deploymentId) {
		await db
			.update(deployments)
			.set({ title, isPreview: true })
			.where(eq(deployments.deploymentId, result.deploymentId));
	}

	await upsertPreviewComment({
		applicationId,
		pullRequestNumber: pr.number,
		status: "deploying",
	});

	return {
		action: result.action,
		previewDeploymentId: result.previewDeploymentId,
		deploymentId: result.deploymentId,
	};
}
