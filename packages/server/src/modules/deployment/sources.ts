import { eq } from "drizzle-orm";
import { simpleGit } from "simple-git";
import { db } from "../../db";
import {
	type applications,
	bitbucket,
	gitea,
	github,
	gitlab,
	registry,
	sshKeys,
} from "../../db/schema";
import type { DeploymentContext } from "./context";
import { getDocker, writeFileTargeted } from "./docker";
import { getAppCodePath, getDropZipPath, getSshKeysPath, shellQuote } from "./paths";

export type ApplicationRow = typeof applications.$inferSelect;

interface GitSource {
	cloneUrl: string;
	branch: string;
	/** Credentials embedded in the URL — registered as logger secrets. */
	secrets: string[];
	/** Extra environment for git (GIT_SSH_COMMAND for custom keys). */
	env?: Record<string, string>;
}

const stripProtocol = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * Build an authenticated clone URL for the application's git source.
 * Mirrors the compose module's provider handling: GitHub App installation
 * tokens, GitLab/Gitea PATs, Bitbucket app passwords, custom SSH keys.
 */
async function resolveGitSource(application: ApplicationRow): Promise<GitSource> {
	switch (application.sourceType) {
		case "git": {
			if (!application.gitUrl) throw new Error("Git source requires a gitUrl");
			const source: GitSource = {
				cloneUrl: application.gitUrl,
				branch: application.gitBranch ?? "main",
				secrets: [],
			};
			if (application.customGitSSHKeyId) {
				const key = await db.query.sshKeys.findFirst({
					where: eq(sshKeys.sshKeyId, application.customGitSSHKeyId),
				});
				if (!key) throw new Error("Custom git SSH key not found");
				const keyPath = `${getSshKeysPath()}/${key.sshKeyId}.pem`;
				await writeFileTargeted(null, keyPath, key.privateKey, "600");
				source.env = {
					GIT_SSH_COMMAND: `ssh -i ${shellQuote(keyPath)} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
				};
			}
			return source;
		}
		case "github": {
			if (!application.owner || !application.repository) {
				throw new Error("GitHub source requires owner and repository");
			}
			let cloneUrl = `https://github.com/${application.owner}/${application.repository}.git`;
			const secrets: string[] = [];
			if (application.githubId) {
				const gh = await db.query.github.findFirst({
					where: eq(github.githubId, application.githubId),
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
						cloneUrl = `https://x-access-token:${token}@github.com/${application.owner}/${application.repository}.git`;
						secrets.push(token);
					} catch {
						// fall back to the unauthenticated URL (public repos)
					}
				}
			}
			return { cloneUrl, branch: application.branch ?? "main", secrets };
		}
		case "gitlab": {
			if (!application.owner || !application.repository) {
				throw new Error("GitLab source requires owner and repository");
			}
			let host = "gitlab.com";
			let token: string | null = null;
			if (application.gitlabId) {
				const gl = await db.query.gitlab.findFirst({
					where: eq(gitlab.gitlabId, application.gitlabId),
				});
				if (gl) {
					host = stripProtocol(gl.gitlabUrl);
					token = gl.accessToken;
				}
			}
			const auth = token ? `oauth2:${token}@` : "";
			return {
				cloneUrl: `https://${auth}${host}/${application.owner}/${application.repository}.git`,
				branch: application.branch ?? "main",
				secrets: token ? [token] : [],
			};
		}
		case "bitbucket": {
			if (!application.owner || !application.repository) {
				throw new Error("Bitbucket source requires owner and repository");
			}
			let auth = "";
			const secrets: string[] = [];
			if (application.bitbucketId) {
				const bb = await db.query.bitbucket.findFirst({
					where: eq(bitbucket.bitbucketId, application.bitbucketId),
				});
				if (bb?.apiToken) {
					auth = `x-token-auth:${bb.apiToken}@`;
					secrets.push(bb.apiToken);
				} else if (bb?.bitbucketUsername && bb?.appPassword) {
					auth = `${encodeURIComponent(bb.bitbucketUsername)}:${bb.appPassword}@`;
					secrets.push(bb.appPassword);
				}
			}
			return {
				cloneUrl: `https://${auth}bitbucket.org/${application.owner}/${application.repository}.git`,
				branch: application.branch ?? "main",
				secrets,
			};
		}
		case "gitea": {
			if (!application.owner || !application.repository) {
				throw new Error("Gitea source requires owner and repository");
			}
			let host = "gitea.com";
			let token: string | null = null;
			if (application.giteaId) {
				const gt = await db.query.gitea.findFirst({
					where: eq(gitea.giteaId, application.giteaId),
				});
				if (gt) {
					host = stripProtocol(gt.giteaUrl);
					token = gt.accessToken;
				}
			}
			const auth = token ? `${token}@` : "";
			return {
				cloneUrl: `https://${auth}${host}/${application.owner}/${application.repository}.git`,
				branch: application.branch ?? "main",
				secrets: token ? [token] : [],
			};
		}
		default:
			throw new Error(`Source type ${application.sourceType} is not a git source`);
	}
}

/**
 * Clone (or fast-forward an existing checkout of) the application's git
 * source into `<configDir>/applications/<appName>/code`, depth 1.
 * Local apps use simple-git; apps pinned to a remote server are cloned with
 * the system git client over SSH.
 */
export async function cloneGitSource(
	ctx: DeploymentContext,
	application: ApplicationRow,
): Promise<string> {
	const source = await resolveGitSource(application);
	for (const secret of source.secrets) ctx.logger.addSecret(secret);
	const codeDir = getAppCodePath(application.appName);

	if (ctx.serverId) {
		const dir = shellQuote(codeDir);
		const url = shellQuote(source.cloneUrl);
		const branch = shellQuote(source.branch);
		const sshEnv = source.env?.GIT_SSH_COMMAND
			? `GIT_SSH_COMMAND=${shellQuote(source.env.GIT_SSH_COMMAND)} `
			: "";
		await ctx.run(
			`mkdir -p ${dir} && ` +
				`(if [ -d ${dir}/.git ]; then ` +
				`${sshEnv}git -C ${dir} fetch --depth 1 origin ${branch} && git -C ${dir} reset --hard FETCH_HEAD; ` +
				`else ${sshEnv}git clone --branch ${branch} --depth 1 --single-branch ${url} ${dir}; fi)`,
		);
		ctx.logger.line(
			`Cloned ${application.owner ?? source.cloneUrl}/${application.repository ?? ""} (${source.branch})`,
		);
		return codeDir;
	}

	// Local: the URL may carry a token — keep it out of the log by not
	// echoing the command (simple-git instead of a shell command).
	ctx.logger.line(
		`Cloning ${application.owner ?? "repository"}/${application.repository ?? ""} (branch: ${source.branch})`,
	);
	const fs = await import("node:fs/promises");
	await fs.mkdir(codeDir, { recursive: true });
	const git = simpleGit({ baseDir: codeDir });
	if (source.env) git.env(source.env);
	const isRepo = await git.checkIsRepo().catch(() => false);
	if (isRepo) {
		await git.fetch(["origin", source.branch, "--depth", "1"]);
		await git.reset(["--hard", "FETCH_HEAD"]);
	} else {
		await fs.rm(codeDir, { recursive: true, force: true });
		await fs.mkdir(codeDir, { recursive: true });
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

/**
 * Unpack the uploaded drop archive (`<configDir>/applications/<appName>/code.zip`)
 * into the code directory. Local extracts use adm-zip; remote servers receive
 * the zip over SSH and unpack it with `unzip` (python3 fallback).
 */
export async function extractDropSource(
	ctx: DeploymentContext,
	application: ApplicationRow,
): Promise<string> {
	const zipPath = getDropZipPath(application.appName);
	const codeDir = getAppCodePath(application.appName);
	ctx.logger.line("Extracting uploaded source archive...");

	if (ctx.serverId) {
		const fs = await import("node:fs/promises");
		const zip = await fs.readFile(zipPath).catch(() => {
			throw new Error(`Drop archive not found at ${zipPath} — upload a zip before deploying`);
		});
		await writeFileTargeted(ctx.serverId, zipPath, zip);
		const dir = shellQuote(codeDir);
		const zipQ = shellQuote(zipPath);
		await ctx.run(
			`rm -rf ${dir} && mkdir -p ${dir} && ` +
				`(if command -v unzip >/dev/null 2>&1; then unzip -o -q ${zipQ} -d ${dir}; ` +
				`else python3 -m zipfile -e ${zipQ} ${dir}; fi)`,
		);
		return codeDir;
	}

	const { default: AdmZip } = await import("adm-zip");
	const fs = await import("node:fs/promises");
	await fs.rm(codeDir, { recursive: true, force: true });
	await fs.mkdir(codeDir, { recursive: true });
	try {
		new AdmZip(zipPath).extractAllTo(codeDir, true);
	} catch (error) {
		throw new Error(
			`Failed to extract drop archive at ${zipPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return codeDir;
}

export interface RegistryAuth {
	username: string;
	password: string;
	serveraddress?: string;
}

/** Resolve pull credentials: explicit registry row wins over inline user/pass. */
export async function resolveRegistryAuth(
	application: ApplicationRow,
): Promise<RegistryAuth | null> {
	if (application.registryId) {
		const reg = await db.query.registry.findFirst({
			where: eq(registry.registryId, application.registryId),
		});
		if (!reg) throw new Error("Configured registry not found");
		return {
			username: reg.username,
			password: reg.password,
			serveraddress: reg.registryUrl || undefined,
		};
	}
	if (application.username && application.password) {
		return { username: application.username, password: application.password };
	}
	return null;
}

/**
 * Pull the application's docker image on the target server, streaming
 * progress into the deployment log. Returns the image reference.
 */
export async function pullDockerImage(
	ctx: DeploymentContext,
	application: ApplicationRow,
): Promise<string> {
	const image = application.dockerImage;
	if (!image) throw new Error("Docker source requires a dockerImage");

	const auth = await resolveRegistryAuth(application);
	if (auth) ctx.logger.addSecret(auth.password);

	ctx.logger.line(`Pulling image ${image}...`);
	const docker = await getDocker(ctx.serverId);
	const stream = await docker.pull(image, auth ? { authconfig: auth } : {});

	await new Promise<void>((resolve, reject) => {
		docker.modem.followProgress(
			stream,
			(err: Error | null) => (err ? reject(err) : resolve()),
			(event: { id?: string; status?: string; progress?: string; error?: string }) => {
				if (event.error) {
					ctx.logger.line(`Pull error: ${event.error}`);
					return;
				}
				// Only log layer transitions, not every progress tick.
				if (event.status && !event.progress) {
					ctx.logger.line(`${event.id ? `${event.id}: ` : ""}${event.status}`);
				}
			},
		);
	});
	ctx.logger.line(`Image ${image} pulled`);
	return image;
}
