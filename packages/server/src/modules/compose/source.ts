import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { simpleGit } from "simple-git";
import { db } from "../../db";
import type { compose } from "../../db/schema";
import { bitbucket, gitea, github, gitlab, sshKeys } from "../../db/schema";
import { execAsync, execAsyncRemote } from "../../utils/exec";
import { getComposeCodeDir, NIXPLOY_CONFIG_DIR, shellQuote } from "./paths";

export type ComposeRow = typeof compose.$inferSelect;

interface GitSource {
	cloneUrl: string;
	branch: string;
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
			if (!composeRow.gitUrl) throw new Error("Git source requires gitUrl");
			const source: GitSource = {
				cloneUrl: composeRow.gitUrl,
				branch: composeRow.gitBranch ?? "main",
			};
			if (composeRow.customGitSSHKeyId) {
				const key = await db.query.sshKeys.findFirst({
					where: eq(sshKeys.sshKeyId, composeRow.customGitSSHKeyId),
				});
				if (!key) throw new Error("Custom git SSH key not found");
				const keyPath = join(NIXPLOY_CONFIG_DIR, "ssh", `${key.sshKeyId}.pem`);
				await mkdir(dirname(keyPath), { recursive: true });
				await writeFile(keyPath, key.privateKey, { mode: 0o600 });
				await chmod(keyPath, 0o600);
				source.env = {
					GIT_SSH_COMMAND: `ssh -i ${shellQuote(keyPath)} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${shellQuote(join(NIXPLOY_CONFIG_DIR, "ssh", "known_hosts"))}`,
				};
			}
			return source;
		}
		case "github": {
			if (!composeRow.owner || !composeRow.repository) {
				throw new Error("GitHub source requires owner and repository");
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
						const { token } = (await appAuth({ type: "installation" })) as { token: string };
						cloneUrl = `https://x-access-token:${token}@github.com/${composeRow.owner}/${composeRow.repository}.git`;
					} catch {
						// fall through to the unauthenticated URL (public repos)
					}
				}
			}
			return { cloneUrl, branch: composeRow.branch ?? "main" };
		}
		case "gitlab": {
			if (!composeRow.owner || !composeRow.repository) {
				throw new Error("GitLab source requires owner and repository");
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
			};
		}
		case "bitbucket": {
			if (!composeRow.owner || !composeRow.repository) {
				throw new Error("Bitbucket source requires owner and repository");
			}
			let auth = "";
			if (composeRow.bitbucketId) {
				const bb = await db.query.bitbucket.findFirst({
					where: eq(bitbucket.bitbucketId, composeRow.bitbucketId),
				});
				if (bb?.apiToken) {
					auth = `x-token-auth:${bb.apiToken}@`;
				} else if (bb?.bitbucketUsername && bb.appPassword) {
					auth = `${encodeURIComponent(bb.bitbucketUsername)}:${bb.appPassword}@`;
				}
			}
			return {
				cloneUrl: `https://${auth}bitbucket.org/${composeRow.owner}/${composeRow.repository}.git`,
				branch: composeRow.branch ?? "main",
			};
		}
		case "gitea": {
			if (!composeRow.owner || !composeRow.repository) {
				throw new Error("Gitea source requires owner and repository");
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
			};
		}
		default:
			throw new Error(`Source type ${composeRow.sourceType} has no git repository to clone`);
	}
}

/**
 * Clone (or fast-forward) the compose row's git source into
 * `<configDir>/compose/<appName>/code`. Local rows use simple-git; rows
 * pinned to a remote server are cloned over SSH with the system git client.
 */
export async function cloneComposeSource(composeRow: ComposeRow): Promise<string> {
	const source = await resolveGitSource(composeRow);
	const codeDir = getComposeCodeDir(composeRow.appName);

	if (composeRow.serverId) {
		const dir = shellQuote(codeDir);
		const url = shellQuote(source.cloneUrl);
		const branch = shellQuote(source.branch);
		await execAsyncRemote(
			composeRow.serverId,
			`mkdir -p ${dir} && ` +
				`(if [ -d ${dir}/.git ]; then ` +
				`git -C ${dir} fetch --depth 1 origin ${branch} && git -C ${dir} reset --hard FETCH_HEAD; ` +
				`else git clone --branch ${branch} --depth 1 --single-branch ${url} ${dir}; fi)`,
		);
		return codeDir;
	}

	await mkdir(codeDir, { recursive: true });
	const git = simpleGit({ baseDir: codeDir });
	if (source.env) git.env(source.env);
	const isRepo = await git.checkIsRepo().catch(() => false);
	if (isRepo) {
		await git.fetch(["origin", source.branch, "--depth", "1"]);
		await git.reset(["--hard", "FETCH_HEAD"]);
	} else {
		await rm(codeDir, { recursive: true, force: true });
		await mkdir(codeDir, { recursive: true });
		await git.clone(source.cloneUrl, codeDir, [
			"--branch",
			source.branch,
			"--depth",
			"1",
			"--single-branch",
		]);
	}
	return codeDir;
}

/** Run a compose lifecycle command locally or on the row's remote server. */
export async function runComposeCommand(
	composeRow: ComposeRow,
	command: string,
	options: { cwd?: string } = {},
): Promise<string> {
	if (composeRow.serverId) {
		const cwd = options.cwd ? `cd ${shellQuote(options.cwd)} && ` : "";
		return execAsyncRemote(composeRow.serverId, `${cwd}${command}`);
	}
	return execAsync(command, { cwd: options.cwd });
}

/** Write a file on the target server (local fs, or base64 over SSH). */
export async function writeComposeFile(
	composeRow: ComposeRow,
	path: string,
	content: string,
): Promise<void> {
	if (composeRow.serverId) {
		const base64 = Buffer.from(content, "utf8").toString("base64");
		await execAsyncRemote(
			composeRow.serverId,
			`mkdir -p ${shellQuote(dirname(path))} && echo ${base64} | base64 -d > ${shellQuote(path)}`,
		);
		return;
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

/** Read a file from the target server (local fs, or `cat` over SSH). */
export async function readComposeFile(composeRow: ComposeRow, path: string): Promise<string> {
	if (composeRow.serverId) {
		return execAsyncRemote(composeRow.serverId, `cat ${shellQuote(path)}`);
	}
	const { readFile } = await import("node:fs/promises");
	return readFile(path, "utf8");
}
