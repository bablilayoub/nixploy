import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import type { compose } from "../../db/schema";
import { bitbucket, gitea, github, gitlab, sshKeys } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { assertSafeGitRef } from "../../utils/public-url";
import { writeFileTargeted } from "../deployment/docker";
import { getSshKeysPath } from "../deployment/paths";
import {
	buildGitSshCommand,
	gitProcessEnv,
	gitProtocolEnv,
	hardenedSimpleGit,
} from "../deployment/sources";
import { badRequest, notFound } from "../errors";
import { getComposeCodeDir, shellQuote } from "./paths";

export type ComposeRow = typeof compose.$inferSelect;

interface GitSource {
	cloneUrl: string;
	branch: string;
	/** Tokens embedded in cloneUrl — register with the deployment logger. */
	secrets?: string[];
	/** Extra environment for git (e.g. GIT_SSH_COMMAND for custom keys). */
	env?: Record<string, string>;
}

const stripProtocol = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Build an authenticated clone URL for the compose row's git provider.
 * Falls back to the plain HTTPS URL when no usable credential is configured,
 * which still works for public repositories.
 */
async function resolveGitSource(composeRow: ComposeRow): Promise<GitSource> {
	switch (composeRow.sourceType) {
		case "git": {
			if (!composeRow.gitUrl) throw badRequest("Git source requires gitUrl");
			const source: GitSource = {
				cloneUrl: composeRow.gitUrl,
				branch: composeRow.gitBranch ?? "main",
			};
			if (composeRow.customGitSSHKeyId) {
				const key = await db.query.sshKeys.findFirst({
					where: eq(sshKeys.sshKeyId, composeRow.customGitSSHKeyId),
				});
				if (!key) throw notFound("Custom git SSH key not found");
				const keyPath = join(getSshKeysPath(), `${key.sshKeyId}.pem`);
				// The key must exist where git runs: on the managed server for
				// remote rows, on the Nixploy host otherwise.
				await writeFileTargeted(composeRow.serverId, keyPath, key.privateKey, "600");
				source.env = { GIT_SSH_COMMAND: buildGitSshCommand(keyPath) };
			}
			return source;
		}
		case "github": {
			if (!composeRow.owner || !composeRow.repository) {
				throw badRequest("GitHub source requires owner and repository");
			}
			let cloneUrl = `https://github.com/${composeRow.owner}/${composeRow.repository}.git`;
			if (composeRow.githubId) {
				const gh = await db.query.github.findFirst({
					where: eq(github.githubId, composeRow.githubId),
				});
				if (gh?.githubAppId && gh.githubPrivateKey && gh.githubInstallationId) {
					try {
						const { createAppAuth } = await import("@octokit/auth-app");
						const appAuth = createAppAuth({
							appId: gh.githubAppId,
							privateKey: gh.githubPrivateKey,
							installationId: gh.githubInstallationId,
						});
						const { token } = (await appAuth({ type: "installation" })) as {
							token: string;
						};
						cloneUrl = `https://x-access-token:${token}@github.com/${composeRow.owner}/${composeRow.repository}.git`;
						return {
							cloneUrl,
							branch: composeRow.branch ?? "main",
							secrets: [token],
						};
					} catch {
						// fall through to the unauthenticated URL (public repos)
					}
				}
			}
			return { cloneUrl, branch: composeRow.branch ?? "main" };
		}
		case "gitlab": {
			if (!composeRow.owner || !composeRow.repository) {
				throw badRequest("GitLab source requires owner and repository");
			}
			let host = "gitlab.com";
			let token: string | null = null;
			if (composeRow.gitlabId) {
				const gl = await db.query.gitlab.findFirst({
					where: eq(gitlab.gitlabId, composeRow.gitlabId),
				});
				if (gl) {
					host = stripProtocol(gl.gitlabUrl);
					token = gl.accessToken;
				}
			}
			const auth = token ? `oauth2:${token}@` : "";
			return {
				cloneUrl: `https://${auth}${host}/${composeRow.owner}/${composeRow.repository}.git`,
				branch: composeRow.branch ?? "main",
				secrets: token ? [token] : undefined,
			};
		}
		case "bitbucket": {
			if (!composeRow.owner || !composeRow.repository) {
				throw badRequest("Bitbucket source requires owner and repository");
			}
			let auth = "";
			const secrets: string[] = [];
			if (composeRow.bitbucketId) {
				const bb = await db.query.bitbucket.findFirst({
					where: eq(bitbucket.bitbucketId, composeRow.bitbucketId),
				});
				if (bb?.apiToken) {
					auth = `x-token-auth:${bb.apiToken}@`;
					secrets.push(bb.apiToken);
				} else if (bb?.bitbucketUsername && bb.appPassword) {
					auth = `${encodeURIComponent(bb.bitbucketUsername)}:${bb.appPassword}@`;
					secrets.push(bb.appPassword);
				}
			}
			return {
				cloneUrl: `https://${auth}bitbucket.org/${composeRow.owner}/${composeRow.repository}.git`,
				branch: composeRow.branch ?? "main",
				secrets: secrets.length > 0 ? secrets : undefined,
			};
		}
		case "gitea": {
			if (!composeRow.owner || !composeRow.repository) {
				throw badRequest("Gitea source requires owner and repository");
			}
			let host = "gitea.com";
			let token: string | null = null;
			if (composeRow.giteaId) {
				const gt = await db.query.gitea.findFirst({
					where: eq(gitea.giteaId, composeRow.giteaId),
				});
				if (gt) {
					host = stripProtocol(gt.giteaUrl);
					token = gt.accessToken;
				}
			}
			const auth = token ? `${token}@` : "";
			return {
				cloneUrl: `https://${auth}${host}/${composeRow.owner}/${composeRow.repository}.git`,
				branch: composeRow.branch ?? "main",
				secrets: token ? [token] : undefined,
			};
		}
		default:
			throw badRequest(`Source type ${composeRow.sourceType} has no git repository to clone`);
	}
}

/**
 * Clone (or fast-forward) the compose row's git source into
 * `<configDir>/compose/<appName>/code`. Local rows use simple-git; rows
 * pinned to a remote server are cloned over SSH with the system git client.
 *
 * Always `init` + `fetch <ref>` + `reset --hard FETCH_HEAD` (the sequence
 * `modules/deployment/sources.ts#cloneGitSource` uses): `git clone --branch`
 * only accepts branch and tag names, while a compose preview of a fork pull
 * request fetches `refs/pull/<n>/head` / `refs/merge-requests/<n>/head`,
 * which only `fetch` understands.
 */
export async function cloneComposeSource(composeRow: ComposeRow): Promise<{
	codeDir: string;
	secrets: string[];
}> {
	const source = await resolveGitSource(composeRow);
	// Re-check the ref at USE time: it may come from a webhook payload.
	source.branch = assertSafeGitRef(source.branch);
	const codeDir = getComposeCodeDir(composeRow.appName);
	const secrets = [...(source.secrets ?? [])];
	try {
		const parsed = new URL(source.cloneUrl);
		if (parsed.password) secrets.push(parsed.password);
		if (parsed.username && parsed.password) secrets.push(`${parsed.username}:${parsed.password}`);
	} catch {
		// SSH URLs are not WHATWG URLs — fine.
	}

	// Same hardened git environment application deploys use (`gitProtocolEnv`
	// in `modules/deployment/sources.ts`): only https and ssh are accepted as
	// transports and the URL is never "from the user", so `ext::`, `file://`
	// and the helper-executing schemes are refused by git itself and not only
	// by our URL checks (security audit 2.6).
	const gitEnv = { ...gitProtocolEnv(), ...(source.env ?? {}) };

	if (composeRow.serverId) {
		const dir = shellQuote(codeDir);
		const url = shellQuote(source.cloneUrl);
		const branch = shellQuote(source.branch);
		const prefix = Object.entries(gitEnv)
			.map(([key, value]) => `${key}=${shellQuote(value)} `)
			.join("");
		await execAsyncRemote(
			composeRow.serverId,
			// Refresh the remote first: the URL baked in at clone time carries a
			// short-lived installation token / a rotatable PAT, and the
			// repository or provider may have changed since.
			`(if [ -d ${dir}/.git ]; then ${prefix}git -C ${dir} remote set-url origin ${url}; ` +
				`else rm -rf ${dir} && mkdir -p ${dir} && ${prefix}git init -q ${dir} && ${prefix}git -C ${dir} remote add origin ${url}; fi) && ` +
				`${prefix}git -C ${dir} fetch --depth 1 origin ${branch} && ${prefix}git -C ${dir} reset --hard FETCH_HEAD`,
		);
		return { codeDir, secrets };
	}

	const isRepo = await stat(join(codeDir, ".git"))
		.then((entry) => entry.isDirectory())
		.catch(() => false);
	if (!isRepo) {
		await rm(codeDir, { recursive: true, force: true });
	}
	await mkdir(codeDir, { recursive: true });
	const git = hardenedSimpleGit(codeDir);
	// simple-git's env() replaces the child environment wholesale — keep PATH.
	git.env(gitProcessEnv(gitEnv));
	if (isRepo) {
		// Refresh the remote first (see the remote branch above).
		await git.remote(["set-url", "origin", source.cloneUrl]);
	} else {
		await git.init();
		await git.addRemote("origin", source.cloneUrl);
	}
	await git.fetch(["--depth", "1", "origin", source.branch]);
	await git.reset(["--hard", "FETCH_HEAD"]);
	return { codeDir, secrets };
}

/**
 * Where a compose row's commands run. Plain `docker compose` and every
 * container-level command (ps/inspect/network connect) target the row's
 * server; `onPrimary` forces the Nixploy host, which is where Swarm
 * SERVICE-level commands — `docker stack deploy/rm`, `docker service …` —
 * must run: managed servers join the primary swarm as workers whose engines
 * reject them. Stack tasks still land on the pinned server through the
 * `node.id==` constraint injected into the rendered file.
 */
export interface ComposeCommandTarget {
	onPrimary?: boolean;
}

/** Run a compose lifecycle command locally or on the row's remote server. */
export async function runComposeCommand(
	composeRow: ComposeRow,
	command: string,
	options: ComposeCommandTarget & { cwd?: string } = {},
): Promise<string> {
	if (composeRow.serverId && !options.onPrimary) {
		const cwd = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : "";
		return execAsyncRemote(composeRow.serverId, `${cwd}${command}`);
	}
	return execAsync(command, { cwd: options.cwd });
}

/**
 * Write a file on the target server (local fs, or base64 over SSH).
 * `mode` is applied after the write so an existing file is tightened too.
 * `onPrimary` writes on the Nixploy host regardless of the row's server
 * (the rendered stack file must sit where `docker stack deploy` runs).
 */
export async function writeComposeFile(
	composeRow: ComposeRow,
	path: string,
	content: string,
	options: ComposeCommandTarget & { mode?: number } = {},
): Promise<void> {
	if (composeRow.serverId && !options.onPrimary) {
		// Streamed over the SSH channel's stdin: compose files and .env can
		// exceed the remote shell's argv limit and must never sit in `ps`.
		await writeFileTargeted(composeRow.serverId, path, content, options.mode?.toString(8));
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, { encoding: "utf8", mode: options.mode });
	if (options.mode !== undefined) await chmod(path, options.mode);
}

/** Read a file from the target server (local fs, or `cat` over SSH). */
export async function readComposeFile(composeRow: ComposeRow, path: string): Promise<string> {
	if (composeRow.serverId) {
		return execAsyncRemote(composeRow.serverId, `cat ${shellQuote(path)}`);
	}
	const { readFile } = await import("node:fs/promises");
	return readFile(path, "utf8");
}
