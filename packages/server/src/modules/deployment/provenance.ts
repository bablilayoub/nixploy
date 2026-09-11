import { access } from "node:fs/promises";
import type { DeploymentTrigger } from "../../db/schema/deployment";
import { getDropZipPath } from "./paths";

export type { DeploymentTrigger } from "../../db/schema/deployment";

/**
 * Who/what started a deployment. Stored on the `deployment` row so the
 * history can show "Webhook · push to main · abc1234 by Jane" instead of a
 * bare "Redeploy" title.
 */
export interface DeploymentProvenance {
	trigger: DeploymentTrigger;
	/** User id (`manual` / `api` / `rollback`), `webhook:<provider>`, `schedule:<id>`, … */
	triggeredBy?: string | null;
	commitSha?: string | null;
	/** Full commit message; the UI shows the first line. */
	commitMessage?: string | null;
	commitAuthor?: string | null;
}

/** The minimal session shape the routers hand over (better-auth or the API-key adapter). */
export interface CallerSession {
	user: { id: string };
	session: { id?: string | null; token?: string | null };
}

/**
 * API-key callers (REST adapter, MCP, CLI) get a synthesized session from
 * `lib/api-key-context.ts` whose id is `api-key_<keyId>` and whose token is
 * the literal `"api-key"`; a browser session is anything else.
 */
export function isApiKeySession(session: CallerSession): boolean {
	return (
		session.session.token === "api-key" ||
		(typeof session.session.id === "string" && session.session.id.startsWith("api-key_"))
	);
}

/** `manual` for a signed-in user, `api` for an API key — both attributed to the user. */
export function provenanceForSession(session: CallerSession): DeploymentProvenance {
	return {
		trigger: isApiKeySession(session) ? "api" : "manual",
		triggeredBy: session.user.id,
	};
}

/* -------------------------------------------------------------------------- */
/*  Pre-flight                                                                */
/* -------------------------------------------------------------------------- */

export interface DeployReadiness {
	canDeploy: boolean;
	/** Human-readable blocker, present only when `canDeploy` is false. */
	reason?: string;
}

const READY: DeployReadiness = { canDeploy: true };

/** Message shared by the router error and the disabled Deploy button. */
export const SOURCE_NOT_CONFIGURED = "Set a repository URL or Docker image first";

type ApplicationSourceFields = {
	appName: string;
	sourceType: "docker" | "git" | "github" | "gitlab" | "bitbucket" | "gitea" | "drop";
	dockerImage?: string | null;
	gitUrl?: string | null;
	owner?: string | null;
	repository?: string | null;
};

type ComposeSourceFields = {
	sourceType: "raw" | "git" | "github" | "gitlab" | "bitbucket" | "gitea";
	composeFile?: string | null;
	gitUrl?: string | null;
	owner?: string | null;
	repository?: string | null;
};

const present = (value: string | null | undefined): boolean =>
	typeof value === "string" && value.trim().length > 0;

/**
 * Can the deploy worker even start on this application? Mirrors the checks
 * `sources.ts` performs 15 ms into a job, so the router can refuse with a
 * clear message before a row is queued and the UI can disable Deploy with
 * the same hint. Drop sources check the uploaded archive on the Nixploy
 * host (remote servers receive it from there).
 */
export async function applicationReadiness(
	application: ApplicationSourceFields,
): Promise<DeployReadiness> {
	switch (application.sourceType) {
		case "docker":
			return present(application.dockerImage)
				? READY
				: { canDeploy: false, reason: SOURCE_NOT_CONFIGURED };
		case "git":
			return present(application.gitUrl)
				? READY
				: { canDeploy: false, reason: SOURCE_NOT_CONFIGURED };
		case "github":
		case "gitlab":
		case "bitbucket":
		case "gitea":
			return present(application.owner) && present(application.repository)
				? READY
				: { canDeploy: false, reason: SOURCE_NOT_CONFIGURED };
		case "drop": {
			const exists = await access(getDropZipPath(application.appName)).then(
				() => true,
				() => false,
			);
			return exists ? READY : { canDeploy: false, reason: "Upload a source archive (zip) first" };
		}
		default:
			return READY;
	}
}

/** Same idea for compose services: a raw file must be non-empty, git sources need a repo. */
export function composeReadiness(row: ComposeSourceFields): DeployReadiness {
	if (row.sourceType === "raw") {
		return present(row.composeFile)
			? READY
			: { canDeploy: false, reason: "Save a compose file first" };
	}
	if (row.sourceType === "git") {
		return present(row.gitUrl)
			? READY
			: { canDeploy: false, reason: "Set a repository URL for the compose source first" };
	}
	return present(row.owner) && present(row.repository)
		? READY
		: { canDeploy: false, reason: "Select a repository for the compose source first" };
}

/* -------------------------------------------------------------------------- */
/*  Commit metadata                                                           */
/* -------------------------------------------------------------------------- */

export interface CommitInfo {
	sha: string;
	message: string | null;
	author: string | null;
}

/** `git log -1 --format=%H%n%an%n%s` — one line each; blank/garbage → null. */
export const CHECKOUT_COMMIT_FORMAT = "%H%n%an%n%s";

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

export function parseCheckoutCommit(output: string): CommitInfo | null {
	const [sha = "", author = "", ...subject] = output.replace(/\r/g, "").split("\n");
	const cleanSha = sha.trim();
	if (!SHA_PATTERN.test(cleanSha)) return null;
	const message = subject.join("\n").trim();
	return {
		sha: cleanSha,
		author: author.trim() || null,
		message: message || null,
	};
}

/** First non-empty line of a commit message / error, for compact display. */
export function firstLine(text: string | null | undefined): string | null {
	if (!text) return null;
	const line = text
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0);
	return line ?? null;
}
