import { timingSafeEqual } from "node:crypto";
import { DomainError } from "../../errors";

/**
 * Types, header/payload helpers and error signals shared by the four webhook
 * provider verifiers (`./github`, `./gitlab`, `./bitbucket`, `./gitea`) and
 * the dispatcher (`../handler.ts`).
 */

export type GitWebhookProvider = "github" | "gitlab" | "bitbucket" | "gitea";

/** Head commit of a push (or a PR head), as far as the provider payload says. */
export type WebhookCommit = {
	sha: string;
	message: string | null;
	author: string | null;
};

export type PullRequestWebhookInfo = {
	action: string;
	number: string;
	id?: string | null;
	title?: string | null;
	url?: string | null;
	/** PR head lives in a different repository than the base (fork PR). */
	isFork?: boolean;
	/** `owner/repo` of the head repository (Bitbucket fork previews clone it). */
	headRepoFullName?: string | null;
	/** Head commit sha, when the provider sends it (metadata-only update detection). */
	headCommit?: string | null;
	/**
	 * Encoded source the preview must build (`preview/source-ref.ts`): the
	 * branch for same-repo PRs, the provider PR head ref or the fork repo for
	 * fork PRs. Set by `handleGitWebhook`.
	 */
	sourceRef?: string | null;
	/** Provider login of the PR author (collaborator bypass + UI display). */
	authorLogin?: string | null;
};

export type GitWebhookResult = {
	provider: GitWebhookProvider;
	/** Ids of applications that should react to this delivery. */
	applicationIds: string[];
	branch: string;
	/** Provider-native event kind, normalized: "push" | "pull_request" | "tag". */
	type: "push" | "pull_request" | "tag";
	/** Present when type is pull_request. */
	pullRequest?: PullRequestWebhookInfo;
	/** Head commit (push/tag: from the payload; pull_request: sha only). */
	commit?: WebhookCommit;
};

export type WebhookHeaders = Record<string, string | string[] | undefined>;

/** Normalized payload every provider verifier returns to the dispatcher. */
export type ExtractedWebhook = {
	branch: string;
	type: GitWebhookResult["type"];
	repository: string; // repo name (no owner)
	owner: string; // owner / namespace
	cloneUrl?: string;
	/** Files touched by a push (added/modified/removed across commits). */
	changedPaths?: string[];
	pullRequest?: PullRequestWebhookInfo;
	commit?: WebhookCommit;
};

export class WebhookUnauthorized extends DomainError {
	constructor(message: string) {
		super("UNAUTHORIZED", message);
		this.name = "WebhookUnauthorized";
	}
}

/**
 * Non-error signal for deliveries that are valid but carry no work. Deliberately
 * a plain Error, not a DomainError: the webhook route answers it with 202.
 */
export class WebhookIgnored extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WebhookIgnored";
	}
}

export function header(headers: WebhookHeaders, name: string): string | undefined {
	const value = headers[name.toLowerCase()];
	return Array.isArray(value) ? value[0] : value;
}

export function safeEqual(a: string, b: string): boolean {
	const ba = Buffer.from(a);
	const bb = Buffer.from(b);
	return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function normalizeRef(ref: string | undefined): {
	branch: string;
	isTag: boolean;
} {
	if (!ref) return { branch: "", isTag: false };
	if (ref.startsWith("refs/tags/")) return { branch: ref.slice("refs/tags/".length), isTag: true };
	if (ref.startsWith("refs/heads/"))
		return { branch: ref.slice("refs/heads/".length), isTag: false };
	return { branch: ref, isTag: false };
}

export function asString(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return "";
}

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

/**
 * Head commit of a push payload. `sha` is the provider's `after`/`checkout_sha`
 * (falls back to the commit object's id/hash); the message and author come
 * from the head commit object (GitHub/Gitea `head_commit`, GitLab last
 * `commits[]` entry, Bitbucket `changes[].new.target`). Author fields differ
 * per provider (`author.name`, `author.user.display_name`, Bitbucket's raw
 * `"Name <email>"`), so every shape is tried before the pusher fallback.
 * Branch deletions carry an all-zero sha and yield nothing.
 */
export function extractPushCommit(
	sha: unknown,
	head: unknown,
	fallbackAuthor?: unknown,
): WebhookCommit | undefined {
	const headObj = (head && typeof head === "object" ? head : {}) as Record<string, unknown>;
	const id = asString(sha) || asString(headObj.id) || asString(headObj.hash);
	if (!COMMIT_SHA.test(id) || /^0+$/.test(id)) return undefined;
	const authorObj = (
		headObj.author && typeof headObj.author === "object" ? headObj.author : {}
	) as Record<string, unknown>;
	const authorUser = (
		authorObj.user && typeof authorObj.user === "object" ? authorObj.user : {}
	) as Record<string, unknown>;
	const author =
		asString(authorObj.name) ||
		asString(authorUser.display_name) ||
		asString(authorObj.raw).replace(/\s*<[^>]*>\s*$/, "") ||
		asString(authorObj.username) ||
		asString(fallbackAuthor) ||
		null;
	const message = asString(headObj.message).trim() || null;
	return { sha: id, message, author };
}

/** Collect added/modified/removed paths from a push event's commit list. */
export function collectCommitPaths(commits: unknown): string[] | undefined {
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
