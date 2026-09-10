/**
 * What a PR preview builds from. `previewDeployments.branch` stores it as a
 * single string so no schema change is needed:
 *
 * - `<branch>` — a branch of the application's own repository (same-repo PR);
 * - `refs/pull/<n>/head` / `refs/merge-requests/<n>/head` — the provider's
 *   read-only PR head ref on the BASE repository (fork PRs on GitHub, Gitea,
 *   GitLab). Fork branches do not exist in the base repo, so fetching them by
 *   name always failed;
 * - `fork:<workspace>/<repo>:<branch>` — Bitbucket Cloud exposes no PR ref,
 *   so the head repository is cloned directly (`:` can never appear in a git
 *   branch name, which keeps the encoding unambiguous).
 *
 * This module is a dependency-free leaf shared by the webhook handler (writes)
 * and the deploy worker (reads).
 */

export type PreviewSourceRef =
	| { kind: "branch"; branch: string }
	| { kind: "ref"; ref: string }
	| { kind: "fork"; owner: string; repository: string; branch: string };

export type PreviewProvider = "github" | "gitlab" | "bitbucket" | "gitea";

const FORK_PREFIX = "fork:";

export function encodePreviewSourceRef(ref: PreviewSourceRef): string {
	switch (ref.kind) {
		case "branch":
			return ref.branch;
		case "ref":
			return ref.ref;
		case "fork":
			return `${FORK_PREFIX}${ref.owner}/${ref.repository}:${ref.branch}`;
	}
}

export function parsePreviewSourceRef(value: string | null | undefined): PreviewSourceRef | null {
	if (!value) return null;
	if (value.startsWith(FORK_PREFIX)) {
		const rest = value.slice(FORK_PREFIX.length);
		const colon = rest.indexOf(":");
		if (colon === -1) return null;
		const repo = rest.slice(0, colon);
		const branch = rest.slice(colon + 1);
		// The repository name never contains "/", the owner may (GitLab groups).
		const slash = repo.lastIndexOf("/");
		if (slash <= 0 || slash === repo.length - 1 || !branch) return null;
		return {
			kind: "fork",
			owner: repo.slice(0, slash),
			repository: repo.slice(slash + 1),
			branch,
		};
	}
	if (value.startsWith("refs/")) return { kind: "ref", ref: value };
	return { kind: "branch", branch: value };
}

/** Provider ref that resolves a PR's head from the base repository, if any. */
export function pullRequestHeadRef(provider: PreviewProvider, number: string): string | null {
	if (!/^\d{1,10}$/.test(number)) return null;
	switch (provider) {
		case "github":
		case "gitea":
			return `refs/pull/${number}/head`;
		case "gitlab":
			return `refs/merge-requests/${number}/head`;
		case "bitbucket":
			return null;
	}
}

export interface PullRequestSourceInput {
	provider: PreviewProvider;
	number: string;
	/** Head branch name as reported by the provider. */
	branch: string;
	isFork: boolean;
	/** `owner/repo` of the head repository (needed for Bitbucket forks). */
	headRepoFullName?: string | null;
}

/**
 * Encoded source ref for a PR: same-repo PRs keep the plain branch (unchanged
 * behaviour and display); fork PRs use the provider head ref, or the head
 * repository itself on Bitbucket. Returns null when a fork PR carries no
 * usable source (the caller should ignore the delivery).
 */
export function previewSourceRefForPullRequest(input: PullRequestSourceInput): string | null {
	if (!input.isFork) {
		return input.branch ? encodePreviewSourceRef({ kind: "branch", branch: input.branch }) : null;
	}
	const ref = pullRequestHeadRef(input.provider, input.number);
	if (ref) return encodePreviewSourceRef({ kind: "ref", ref });
	const full = input.headRepoFullName ?? "";
	const slash = full.lastIndexOf("/");
	if (slash <= 0 || slash === full.length - 1 || !input.branch) return null;
	return encodePreviewSourceRef({
		kind: "fork",
		owner: full.slice(0, slash),
		repository: full.slice(slash + 1),
		branch: input.branch,
	});
}

/**
 * Whether a `pullrequest:updated`-style delivery changed nothing worth
 * rebuilding: Bitbucket fires it for title/description/reviewer edits too, so
 * the head commit is compared with what the preview last checked out.
 * Unknown commits (never built, checkout missing) always rebuild.
 */
export function isMetadataOnlyPullRequestUpdate(input: {
	action: string;
	headCommit: string | null | undefined;
	deployedCommit: string | null | undefined;
}): boolean {
	if (input.action.toLowerCase() !== "updated") return false;
	const head = (input.headCommit ?? "").trim().toLowerCase();
	const deployed = (input.deployedCommit ?? "").trim().toLowerCase();
	// Providers may send abbreviated hashes; require at least a short sha.
	if (head.length < 7 || deployed.length < 7) return false;
	return head === deployed || head.startsWith(deployed) || deployed.startsWith(head);
}
