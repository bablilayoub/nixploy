/**
 * Provider commit links.
 *
 * A deployment / preview row stores a sha; turning it into a clickable URL
 * needs the *service's* source row, because only GitHub and Bitbucket Cloud
 * have one canonical host. GitLab, Gitea and Bitbucket Server are usually
 * self-hosted, so their base URL comes from the git-provider row
 * (`gitlab.gitlabUrl` / `gitea.giteaUrl`, resolved by `./commit-link.ts`) —
 * guessing `gitlab.com` would produce links that 404 for every self-hosted
 * install.
 *
 * This module is deliberately **import-free** (like `modules/services/kinds`)
 * so the panel can bundle it into a client component without dragging the db
 * in.
 */

/** Enough of a service row to point a commit sha at the provider's commit page. */
export interface CommitLinkSource {
	/** `application.sourceType` / `compose.sourceType`. */
	sourceType: string;
	owner?: string | null;
	repository?: string | null;
	/** Raw remote for `sourceType: "git"` (https, ssh:// or scp-style). */
	gitUrl?: string | null;
	/** Self-hosted GitLab / Gitea / Bitbucket base URL from the provider row. */
	providerUrl?: string | null;
}

const withProtocol = (url: string): string => (/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

/** `https://host/owner/repo` from an https, ssh:// or scp-style git URL; null otherwise. */
export function webRepoFromGitUrl(gitUrl: string): string | null {
	const trimmed = gitUrl.trim();
	if (!trimmed) return null;
	// `git@host:owner/repo.git` — scp syntax has no scheme, so URL() misparses it.
	const scp = trimmed.match(/^(?:[\w.-]+@)?([\w.-]+):([\w./-]+?)(?:\.git)?\/?$/);
	if (scp && !trimmed.includes("://")) {
		return `https://${scp[1]}/${scp[2]}`;
	}
	try {
		const url = new URL(trimmed);
		if (!/^(https?|ssh|git)(\+ssh)?:$/.test(url.protocol)) return null;
		const path = url.pathname.replace(/\.git$/, "").replace(/\/$/, "");
		if (path.split("/").filter(Boolean).length < 2) return null;
		return `https://${url.hostname}${path}`;
	} catch {
		return null;
	}
}

/**
 * Provider commit URL for a sha, or null when the source cannot have one.
 *
 * Docker-image, drop-zip and raw-compose services return null (the "sha" of a
 * docker deployment is an image digest), and so do self-hosted providers
 * whose base URL is unknown — a plain sha is better than a broken link.
 */
export function buildCommitUrl(source: CommitLinkSource, sha: string): string | null {
	const cleanSha = sha.trim();
	if (!cleanSha) return null;
	const repo =
		source.owner && source.repository
			? `${trimSlashes(source.owner)}/${trimSlashes(source.repository)}`
			: null;
	const providerBase = source.providerUrl
		? withProtocol(source.providerUrl.trim()).replace(/\/+$/, "")
		: null;

	switch (source.sourceType) {
		case "github":
			// GitHub Enterprise Server would need a base URL too, but the GitHub
			// integration is an App on github.com only (`modules/git/github.ts`).
			return repo ? `https://github.com/${repo}/commit/${cleanSha}` : null;
		case "gitlab":
			return repo && providerBase ? `${providerBase}/${repo}/-/commit/${cleanSha}` : null;
		case "gitea":
			return repo && providerBase ? `${providerBase}/${repo}/commit/${cleanSha}` : null;
		case "bitbucket":
			// Bitbucket Cloud unless the provider row names a Server/DC host,
			// whose commit path is `/projects/<KEY>/repos/<slug>/commits/<sha>`
			// — not derivable from owner/repo, so a base URL means "cloud-shaped
			// path on that host" and nothing more.
			return repo ? `${providerBase ?? "https://bitbucket.org"}/${repo}/commits/${cleanSha}` : null;
		case "git": {
			const base = source.gitUrl ? webRepoFromGitUrl(source.gitUrl) : null;
			return base ? `${base}/commit/${cleanSha}` : null;
		}
		default:
			return null;
	}
}
