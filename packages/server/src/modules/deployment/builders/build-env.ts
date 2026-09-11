import { randomBytes } from "node:crypto";
import type { DeploymentContext } from "../context";
import { writeFileTargeted } from "../docker";
import { getAppBasePath, shellQuote } from "../paths";

/**
 * Build-time variables off argv.
 *
 * nixpacks / railpack / pack used to receive every build variable as
 * `--env KEY=VALUE` and the Dockerfile builder as `--build-arg KEY=VALUE`,
 * inside `sh -c` on the host or over SSH: readable in `/proc/<pid>/cmdline`
 * by any process on the box and, for `--build-arg`, baked into
 * `docker history` (security audit 2.4).
 *
 * The replacement is the pattern the pre-deploy hook already uses: a 0600
 * file on the TARGET server, streamed over stdin, deleted afterwards.
 *
 * - `pack` takes the file directly (`--env-file`).
 * - `nixpacks` / `railpack` take `--env NAME` with no value, which both CLIs
 *   resolve from their own environment (verified in their sources:
 *   `Environment::from_envs` / `app.FromEnvs`), so the file is sourced with
 *   `set -a` and only the NAMES reach argv.
 * - The Dockerfile builder sends secret-looking args through BuildKit
 *   `--secret` (never in image history) and the rest as plain `--build-arg`.
 */

/** `<config>/applications/<appName>/build-<random>.env` — 0600, deleted after the build. */
export const buildEnvFilePath = (appName: string, suffix = "env"): string =>
	`${getAppBasePath(appName)}/build-${randomBytes(6).toString("hex")}.${suffix}`;

/**
 * Keys whose VALUE must never be baked into `docker history`. Deliberately
 * broad: the same families the deployment-log redactor knows about.
 */
const SECRET_KEY_RE = /(PASS|PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH|PRIVATE|SALT|SIGNATURE)/i;

/** True when a build argument's value must not reach the image history. */
export const isSecretBuildArgKey = (key: string): boolean => SECRET_KEY_RE.test(key);

/** Split a `KEY=VALUE` entry; `null` when the key is not a valid env name. */
export function splitEnvEntry(entry: string): [string, string] | null {
	const eq = entry.indexOf("=");
	if (eq <= 0) return null;
	const key = entry.slice(0, eq);
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
	return [key, entry.slice(eq + 1)];
}

/** Docker `--env-file` body: `KEY=VALUE` lines, no quoting (docker's own format). */
export function renderEnvFile(entries: readonly string[]): string {
	const lines: string[] = [];
	for (const entry of entries) {
		const pair = splitEnvEntry(entry);
		if (!pair) continue;
		// A newline in a value would forge a second assignment in the file.
		lines.push(`${pair[0]}=${pair[1].replace(/[\r\n]+/g, " ")}`);
	}
	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Shell-sourceable body (`KEY='value'`), safe for `set -a && . file`. */
export function renderShellEnvFile(entries: readonly string[]): string {
	const lines: string[] = [];
	for (const entry of entries) {
		const pair = splitEnvEntry(entry);
		if (!pair) continue;
		lines.push(`${pair[0]}=${shellQuote(pair[1])}`);
	}
	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Valid env names present in `entries`, in order. */
export function envNames(entries: readonly string[]): string[] {
	return entries.map(splitEnvEntry).flatMap((pair) => (pair ? [pair[0]] : []));
}

const removeFiles = async (ctx: DeploymentContext, paths: string[]): Promise<void> => {
	if (paths.length === 0) return;
	await ctx.run(`rm -f ${paths.map((path) => shellQuote(path)).join(" ")}`).catch(() => {
		// Best effort: the files are 0600 inside the app's own directory.
	});
};

export interface SourcedBuildEnv {
	/** `set -a && . <file> && set +a && ` — prepend to the build command. */
	prefix: string;
	/** ` --env NAME --env NAME…` — names only, no values. */
	flags: string;
}

/**
 * Run `body` with the build variables exported into the build CLI's
 * environment (nixpacks / railpack). The file is removed afterwards, even
 * when the build throws.
 */
export async function withSourcedBuildEnv<T>(
	ctx: DeploymentContext,
	appName: string,
	entries: readonly string[],
	body: (env: SourcedBuildEnv) => Promise<T>,
): Promise<T> {
	const content = renderShellEnvFile(entries);
	const names = envNames(entries);
	if (!content || names.length === 0) return await body({ prefix: "", flags: "" });
	const path = buildEnvFilePath(appName);
	await writeFileTargeted(ctx.serverId, path, content, "600");
	try {
		return await body({
			prefix: `set -a && . ${shellQuote(path)} && set +a && `,
			flags: names.map((name) => ` --env ${shellQuote(name)}`).join(""),
		});
	} finally {
		await removeFiles(ctx, [path]);
	}
}

export interface EnvFileHandle {
	/** ` --env-file <path>`, or `""` when there is nothing to pass. */
	flag: string;
	/** Absolute path on the target server, or `null` when no file was written. */
	path: string | null;
}

/** Run `body` with a docker/pack `--env-file` flag (empty when there is nothing to pass). */
export async function withEnvFileFlag<T>(
	ctx: DeploymentContext,
	appName: string,
	entries: readonly string[],
	body: (handle: EnvFileHandle) => Promise<T>,
): Promise<T> {
	const content = renderEnvFile(entries);
	if (!content) return await body({ flag: "", path: null });
	const path = buildEnvFilePath(appName);
	await writeFileTargeted(ctx.serverId, path, content, "600");
	try {
		return await body({ flag: ` --env-file ${shellQuote(path)}`, path });
	} finally {
		await removeFiles(ctx, [path]);
	}
}

export interface BuildArgFlags {
	/** ` --build-arg K=V` for values that are safe in image history. */
	buildArgs: string;
	/** ` --secret id=K,src=<file>` for secret-looking values. */
	secrets: string;
	/** Secret ids, for the log line that explains how to read them. */
	secretIds: string[];
}

/**
 * Split build args into plain `--build-arg`s and BuildKit `--secret`s.
 * Secret values are written one per 0600 file on the target server; the
 * Dockerfile must read them with `RUN --mount=type=secret,id=<KEY>`.
 */
export async function withBuildArgFlags<T>(
	ctx: DeploymentContext,
	appName: string,
	entries: ReadonlyArray<[string, string]>,
	body: (flags: BuildArgFlags) => Promise<T>,
): Promise<T> {
	const plain: string[] = [];
	const secrets: string[] = [];
	const secretIds: string[] = [];
	const files: string[] = [];
	for (const [key, value] of entries) {
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		if (isSecretBuildArgKey(key)) {
			const path = buildEnvFilePath(appName, "secret");
			await writeFileTargeted(ctx.serverId, path, value, "600");
			files.push(path);
			secrets.push(` --secret id=${shellQuote(`${key},src=${path}`)}`);
			secretIds.push(key);
		} else {
			plain.push(` --build-arg ${shellQuote(`${key}=${value}`)}`);
		}
	}
	try {
		return await body({
			buildArgs: plain.join(""),
			secrets: secrets.join(""),
			secretIds,
		});
	} finally {
		await removeFiles(ctx, files);
	}
}
