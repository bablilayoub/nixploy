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
import { execAsync, execAsyncRemote, getGitKnownHostsPath } from "../../utils/exec";
import type { DeploymentContext } from "./context";
import { getDocker, writeFileTargeted } from "./docker";
import { getAppCodePath, getDropZipPath, getSshKeysPath, shellQuote } from "./paths";
import { CHECKOUT_COMMIT_FORMAT, type CommitInfo, parseCheckoutCommit } from "./provenance";

export type ApplicationRow = typeof applications.$inferSelect;

interface GitSource {
	cloneUrl: string;
	/**
	 * What to fetch: a branch name, or a full ref such as `refs/pull/12/head`
	 * (fork pull-request previews). Both are valid `git fetch` refspecs.
	 */
	branch: string;
	/** Credentials embedded in the URL — registered as logger secrets. */
	secrets: string[];
	/** Extra environment for git (GIT_SSH_COMMAND for custom keys). */
	env?: Record<string, string>;
}

const stripProtocol = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * `GIT_SSH_COMMAND` for clones with a custom deploy key. Host keys are
 * pinned on first contact into a real known_hosts FILE
 * (`<configDir>/ssh/git_known_hosts`); a later mismatch fails the clone.
 * `IdentitiesOnly` keeps ssh-agent keys of the panel user out of the picture.
 */
export function buildGitSshCommand(keyPath: string): string {
	return (
		`ssh -i ${shellQuote(keyPath)} -o IdentitiesOnly=yes ` +
		`-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${shellQuote(getGitKnownHostsPath())}`
	);
}

/**
 * Build an authenticated clone URL for the application's git source.
 * Mirrors the compose module's provider handling: GitHub App installation
 * tokens, GitLab/Gitea PATs, Bitbucket app passwords, custom SSH keys.
 */
async function resolveGitSource(
	ctx: DeploymentContext,
	application: ApplicationRow,
): Promise<GitSource> {
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
				// The clone runs on the target server, so the identity file must
				// exist there — not only on the Nixploy host.
				await writeFileTargeted(ctx.serverId, keyPath, key.privateKey, "600");
				source.env = { GIT_SSH_COMMAND: buildGitSshCommand(keyPath) };
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
				// A configured integration must work or the deploy must say why —
				// silently falling back to the anonymous URL turns a rotated key
				// or uninstalled app into a misleading "Repository not found".
				if (!gh) {
					throw new Error(
						"The GitHub integration linked to this application no longer exists — re-link it in the Source tab",
					);
				}
				const label = gh.githubAppName ?? gh.githubId;
				if (!gh.githubAppId || !gh.githubPrivateKey || !gh.githubInstallationId) {
					throw new Error(
						`GitHub App "${label}" is not installed on any account yet — finish the installation before deploying`,
					);
				}
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
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.logger.line(`GitHub App "${label}" authentication failed: ${message}`);
					throw new Error(
						`GitHub App "${label}" could not mint an installation token (${message}). Check the app's private key and that it is still installed on ${application.owner}.`,
					);
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
 * Check out the application's git source into
 * `<configDir>/applications/<appName>/code`, depth 1.
 *
 * Always `init` + `fetch <ref>` + `reset --hard FETCH_HEAD` rather than
 * `git clone --branch`: clone only accepts branch/tag names, while fork
 * pull-request previews fetch `refs/pull/<n>/head` /
 * `refs/merge-requests/<n>/head`, which only `fetch` understands. The same
 * sequence refreshes an existing checkout (origin URL is re-set first so
 * repository/provider/token changes take effect on redeploy).
 *
 * Local apps use simple-git; apps pinned to a remote server run the system
 * git client over SSH.
 */
export async function cloneGitSource(
	ctx: DeploymentContext,
	application: ApplicationRow,
): Promise<string> {
	const source = await resolveGitSource(ctx, application);
	for (const secret of source.secrets) ctx.logger.addSecret(secret);
	const codeDir = getAppCodePath(application.appName);
	const label = `${application.owner ?? "repository"}/${application.repository ?? ""}`;

	if (ctx.serverId) {
		const dir = shellQuote(codeDir);
		const url = shellQuote(source.cloneUrl);
		const ref = shellQuote(source.branch);
		const sshEnv = source.env?.GIT_SSH_COMMAND
			? `GIT_SSH_COMMAND=${shellQuote(source.env.GIT_SSH_COMMAND)} `
			: "";
		await ctx.run(
			`(if [ -d ${dir}/.git ]; then git -C ${dir} remote set-url origin ${url}; ` +
				`else rm -rf ${dir} && mkdir -p ${dir} && git init -q ${dir} && git -C ${dir} remote add origin ${url}; fi) && ` +
				`${sshEnv}git -C ${dir} fetch --depth 1 origin ${ref} && git -C ${dir} reset --hard FETCH_HEAD`,
		);
		ctx.logger.line(`Checked out ${label} (${source.branch})`);
		return codeDir;
	}

	// Local: the URL may carry a token — keep it out of the log by not
	// echoing the command (simple-git instead of a shell command).
	ctx.logger.line(`Fetching ${label} (${source.branch})`);
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const hasRepo = await fs
		.stat(path.join(codeDir, ".git"))
		.then((stat) => stat.isDirectory())
		.catch(() => false);
	if (!hasRepo) {
		await fs.rm(codeDir, { recursive: true, force: true });
		await fs.mkdir(codeDir, { recursive: true });
	}
	const git = simpleGit({ baseDir: codeDir });
	// simple-git's env() replaces the child environment wholesale — keep PATH.
	if (source.env) git.env({ ...process.env, ...source.env });
	if (hasRepo) {
		await git.remote(["set-url", "origin", source.cloneUrl]);
	} else {
		await git.init();
		await git.addRemote("origin", source.cloneUrl);
	}
	await git.fetch(["--depth", "1", "origin", source.branch]);
	await git.reset(["--hard", "FETCH_HEAD"]);
	return codeDir;
}

/**
 * Read the commit a fresh checkout landed on (sha, author, subject) so the
 * deployment row can show provenance. Best effort: a missing git binary,
 * an SSH hiccup or an unexpected output shape yields `null`, never a failed
 * deploy. Runs where the clone ran (local or the pinned server) and stays
 * out of the deployment log — the log already says what was checked out.
 */
export async function readCheckoutCommit(
	ctx: DeploymentContext,
	codeDir: string,
): Promise<CommitInfo | null> {
	const command = `git -C ${shellQuote(codeDir)} log -1 --format=${shellQuote(CHECKOUT_COMMIT_FORMAT)}`;
	try {
		const output = ctx.serverId
			? await execAsyncRemote(ctx.serverId, command, { timeoutMs: 15_000 })
			: await execAsync(command, { timeout: 15_000 });
		return parseCheckoutCommit(output);
	} catch {
		return null;
	}
}

/**
 * Repository digest (`sha256:…`) of a pulled image, when the registry sent
 * one. Docker-source deployments have no commit, so the digest is what pins
 * "which nginx:latest did this run" in the history. One image inspect,
 * `null` for local-only images.
 */
export async function resolveImageDigest(
	ctx: DeploymentContext,
	image: string,
): Promise<string | null> {
	try {
		const docker = await getDocker(ctx.serverId);
		const info = await docker.getImage(image).inspect();
		const repoDigest = info.RepoDigests?.[0];
		const at = repoDigest?.indexOf("@") ?? -1;
		return repoDigest && at !== -1 ? repoDigest.slice(at + 1) : null;
	} catch {
		return null;
	}
}

/**
 * Unpack the uploaded drop archive (`<configDir>/applications/<appName>/code.zip`)
 * into the code directory. Rejects Zip-Slip entries locally and on remote hosts.
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
		// Prefer Python zipfile with path checks — unzip(1) does not block Zip-Slip.
		await ctx.run(
			`rm -rf ${dir} && mkdir -p ${dir} && python3 - <<'PY'\n` +
				`import os, zipfile\n` +
				`code_dir = ${JSON.stringify(codeDir)}\n` +
				`zip_path = ${JSON.stringify(zipPath)}\n` +
				`code_dir = os.path.realpath(code_dir)\n` +
				`with zipfile.ZipFile(zip_path) as zf:\n` +
				`    for info in zf.infolist():\n` +
				`        name = info.filename\n` +
				`        parts = name.replace('\\\\', '/').split('/')\n` +
				`        if name.startswith('/') or name.startswith('\\\\') or '..' in parts:\n` +
				`            raise SystemExit(f'unsafe zip entry: {name}')\n` +
				`        dest = os.path.realpath(os.path.join(code_dir, name))\n` +
				`        if dest != code_dir and not dest.startswith(code_dir + os.sep):\n` +
				`            raise SystemExit(f'zip slip: {name}')\n` +
				`        if info.is_dir():\n` +
				`            os.makedirs(dest, exist_ok=True)\n` +
				`            continue\n` +
				`        os.makedirs(os.path.dirname(dest) or code_dir, exist_ok=True)\n` +
				`        with zf.open(info) as src, open(dest, 'wb') as out:\n` +
				`            out.write(src.read())\n` +
				`PY`,
		);
		return codeDir;
	}

	const { default: AdmZip } = await import("adm-zip");
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	await fs.rm(codeDir, { recursive: true, force: true });
	await fs.mkdir(codeDir, { recursive: true });
	try {
		const zip = new AdmZip(zipPath);
		const base = path.resolve(codeDir);
		for (const entry of zip.getEntries()) {
			const name = entry.entryName;
			if (name.startsWith("/") || name.startsWith("\\") || name.split(/[/\\]/).includes("..")) {
				throw new Error(`Unsafe zip entry: ${name}`);
			}
			const dest = path.resolve(base, name);
			if (dest !== base && !dest.startsWith(base + path.sep)) {
				throw new Error(`Zip slip blocked: ${name}`);
			}
			if (entry.isDirectory) {
				await fs.mkdir(dest, { recursive: true });
				continue;
			}
			await fs.mkdir(path.dirname(dest), { recursive: true });
			await fs.writeFile(dest, entry.getData());
		}
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
	/** Registry row metadata used to scope where credentials may be sent. */
	registryUrl?: string | null;
	imagePrefix?: string | null;
}

/**
 * Registry host of an image reference, following Docker's reference rules:
 * the first path component is a registry only when it contains `.`/`:` or is
 * `localhost`; anything else (including `library/ubuntu`, `ubuntu:22.04`)
 * lives on docker.io.
 */
export function imageRegistryHost(image: string): string {
	const slash = image.indexOf("/");
	if (slash === -1) return "docker.io";
	const first = image.slice(0, slash).toLowerCase();
	if (first.includes(".") || first.includes(":") || first === "localhost") return first;
	return "docker.io";
}

/** Normalize a stored registry URL to a bare host (`docker.io` aliases fold). */
function normalizeRegistryHost(registryUrl: string): string {
	const withoutProto = registryUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
	const host = (withoutProto.split("/")[0] ?? "").toLowerCase();
	if (
		host === "index.docker.io" ||
		host === "registry-1.docker.io" ||
		host === "hub.docker.com" ||
		host === "docker.io"
	) {
		return "docker.io";
	}
	return host;
}

/**
 * Decide whether stored registry credentials may be attached to a pull of
 * `image`. The daemon forwards `authconfig` to whatever registry the image
 * reference points at — attaching credentials for a different registry
 * leaks them to a third party. Credentials with no recorded host (inline
 * user/pass) only attach to docker.io, the daemon's default.
 */
export function shouldAttachRegistryAuth(
	auth: Pick<RegistryAuth, "registryUrl" | "imagePrefix"> | null,
	image: string,
): boolean {
	if (!auth) return false;
	const imageHost = imageRegistryHost(image);
	const registryUrl = auth.registryUrl?.trim();
	const imagePrefix = auth.imagePrefix?.trim();
	if (registryUrl && normalizeRegistryHost(registryUrl) === imageHost) return true;
	if (imagePrefix) {
		// Prefixes like "my-org" (docker.io) or "ghcr.io/my-org" name a
		// namespace inside the registry — compare their implied host.
		if (imageRegistryHost(imagePrefix) === imageHost) return true;
	}
	if (!registryUrl && !imagePrefix) {
		// Inline credentials without an explicit registry URL: docker hub only.
		return imageHost === "docker.io";
	}
	return false;
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
			registryUrl: reg.registryUrl || null,
			imagePrefix: reg.imagePrefix,
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
	// Never send registry credentials to a registry the image does not
	// belong to — the daemon forwards authconfig to the image's registry.
	const attachAuth = shouldAttachRegistryAuth(auth, image);
	if (auth && !attachAuth) {
		ctx.logger.line(
			`Skipping registry credentials: image ${image} is not in ${auth.registryUrl || "docker.io"}`,
		);
	}

	ctx.logger.line(`Pulling image ${image}...`);
	const docker = await getDocker(ctx.serverId);
	const authconfig =
		auth && attachAuth
			? { username: auth.username, password: auth.password, serveraddress: auth.serveraddress }
			: undefined;
	const stream = await docker.pull(image, authconfig ? { authconfig } : {});

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
