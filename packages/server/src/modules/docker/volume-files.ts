import { execAsync, execAsyncRemote, execAsyncWithStdin } from "../../utils/exec";
import { hardeningFlags } from "../deployment/hooks";
import { shellQuote } from "../deployment/paths";
import { badRequest, forbidden, notFound } from "../errors";
import { PROTECTED_VOLUMES } from "./protected";

/**
 * Volume file browser (product audit, Platform row "No server SSH web
 * terminal or volume/file browser").
 *
 * Nixploy never mounts a tenant volume into its own filesystem. Every
 * operation runs in a throwaway container that has the volume — and nothing
 * else — attached:
 *
 *   docker run --rm --network none <hardening> -v <vol>:/data[:ro] \
 *     --entrypoint sh alpine -c '<script>'
 *
 * `--network none` means a hostile file can't phone home even if something in
 * the toolbox were exploitable, `:ro` is used for every read, and the
 * hardening flags are the same baseline deploy hooks run under
 * (`modules/deployment/hooks.ts#hardeningFlags`). `--entrypoint sh` is
 * load-bearing for the same reason it is there: without it the image's own
 * entrypoint swallows the script.
 *
 * **Path confinement** is enforced twice. `normalizeVolumePath` rejects
 * `..`, backslashes, NUL bytes and absolute escapes before a path ever
 * reaches a shell; then the container resolves the path with `realpath` and
 * prints it as the first line of stdout, and {@link assertResolvedInsideData}
 * checks that resolved path in Node. The second check is what stops a
 * *symlink* inside the volume (`ln -s /etc data/escape`) from reading
 * outside the mount — a purely lexical check cannot see those.
 */

/** Where the volume is mounted inside the throwaway container. */
export const DATA_MOUNT = "/data";

/**
 * Toolbox image. The same one `modules/backups/runner.ts` already uses for
 * volume backups, so no new image has to be present on a server.
 */
export const VOLUME_TOOL_IMAGE = "alpine";

/** Largest file the viewer will return (bigger ones are a download, not a view). */
export const MAX_READ_BYTES = 512 * 1024;

/** Largest payload a write accepts — same ceiling as a read. */
export const MAX_WRITE_BYTES = MAX_READ_BYTES;

/** Entries one listing returns; deep directories are truncated, not streamed. */
export const MAX_LIST_ENTRIES = 1_000;

/** Volume names docker itself allows. */
const VOLUME_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/;

export type VolumeEntryType = "file" | "directory" | "symlink" | "other";

export interface VolumeEntry {
	/** Base name inside the listed directory. */
	name: string;
	type: VolumeEntryType;
	/** Bytes; 0 for directories. */
	size: number;
	/** Epoch milliseconds of the last modification. */
	modifiedAt: number;
}

/* -------------------------------------------------------------------------- */
/*  Validation (pure)                                                         */
/* -------------------------------------------------------------------------- */

/** Reject anything docker would not accept as a volume name before shelling out. */
export function assertVolumeName(volumeName: string): void {
	if (!VOLUME_NAME_PATTERN.test(volumeName)) {
		throw badRequest(`Invalid volume name: ${volumeName}`);
	}
	if (PROTECTED_VOLUMES.has(volumeName)) {
		throw forbidden(
			`Volume "${volumeName}" holds Nixploy's own database and cannot be browsed or edited`,
		);
	}
}

/**
 * Normalize a browser path into an absolute path under {@link DATA_MOUNT}.
 *
 * Accepts `""`, `/`, `logs`, `/logs/app.log`; rejects `..` in any segment,
 * NUL bytes, backslashes (a Windows-style separator would slip past the
 * segment check) and anything resolving above the mount. The result is
 * always `/data` or `/data/<clean relative path>`.
 */
export function normalizeVolumePath(input: string | null | undefined): string {
	const raw = (input ?? "").trim();
	if (raw.includes("\0")) {
		throw badRequest("Path contains a null byte");
	}
	if (raw.includes("\\")) {
		throw badRequest("Path contains a backslash");
	}
	// A caller may send the mounted form back verbatim (the UI does, from a
	// previous listing); strip the prefix before validating the segments.
	const withoutMount = raw.startsWith(`${DATA_MOUNT}/`)
		? raw.slice(DATA_MOUNT.length + 1)
		: raw === DATA_MOUNT
			? ""
			: raw;

	const segments = withoutMount.split("/").filter((segment) => segment.length > 0);
	for (const segment of segments) {
		if (segment === "." || segment === "..") {
			throw badRequest("Path may not contain '.' or '..' segments");
		}
	}
	if (segments.length > 64) {
		throw badRequest("Path is nested too deeply");
	}
	const joined = segments.join("/");
	if (joined.length > 1024) {
		throw badRequest("Path is too long");
	}
	return joined ? `${DATA_MOUNT}/${joined}` : DATA_MOUNT;
}

/**
 * Second confinement check, against the path the container's `realpath`
 * resolved. Catches symlinks that point out of the mount — the case a
 * lexical check on the *input* can never catch.
 */
export function assertResolvedInsideData(resolved: string): string {
	const clean = resolved.trim();
	if (clean !== DATA_MOUNT && !clean.startsWith(`${DATA_MOUNT}/`)) {
		throw forbidden(`Path escapes the volume: ${clean}`);
	}
	return clean;
}

/* -------------------------------------------------------------------------- */
/*  Command builders (pure)                                                   */
/* -------------------------------------------------------------------------- */

function dockerRun(options: {
	volumeName: string;
	readOnly: boolean;
	interactive?: boolean;
	script: string;
}): string {
	const mount = `${options.volumeName}:${DATA_MOUNT}${options.readOnly ? ":ro" : ""}`;
	return [
		"docker run --rm",
		options.interactive ? "-i" : "",
		"--network none",
		hardeningFlags(),
		`-v ${shellQuote(mount)}`,
		"--entrypoint sh",
		VOLUME_TOOL_IMAGE,
		`-c ${shellQuote(options.script)}`,
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * Shell prologue shared by every script: resolve the requested path and echo
 * the resolved form as the FIRST line of stdout so Node can verify it.
 *
 * `self` follows the path itself, so a symlinked directory *inside* the
 * volume still browses (and one pointing out of it trips the prefix check).
 * `parent` resolves the containing directory and re-appends the base name
 * instead, which is what a new file needs (BusyBox `realpath` is happy to
 * resolve a path that does not exist, but the parent must) — and what a
 * delete needs, so removing a symlink removes the *link* and never its
 * target.
 */
function resolvePrologue(path: string, mode: "self" | "parent"): string {
	const quoted = shellQuote(path);
	if (mode === "self") {
		return [
			`P=${quoted}`,
			'T=$(realpath "$P" 2>/dev/null) || exit 44',
			'printf "%s\\n" "$T"',
			'case "$T" in /data|/data/*) ;; *) exit 45 ;; esac',
			// BusyBox `realpath` resolves a non-existent path happily, so the
			// existence check has to be its own step.
			'[ -e "$T" ] || exit 44',
		].join("; ");
	}
	return [
		`P=${quoted}`,
		'D=$(dirname "$P")',
		'B=$(basename "$P")',
		'R=$(realpath "$D" 2>/dev/null) || exit 44',
		'[ -d "$R" ] || exit 44',
		'T="$R/$B"',
		'printf "%s\\n" "$T"',
		'case "$T" in /data/*) ;; *) exit 45 ;; esac',
	].join("; ");
}

/** `ls` of one directory: type, size, mtime and name per entry. */
export function buildListCommand(volumeName: string, path: string): string {
	const script = [
		resolvePrologue(path, "self"),
		'[ -d "$T" ] || exit 46',
		`find "$T" -mindepth 1 -maxdepth 1 -exec stat -c '%F|%s|%Y|%n' {} + 2>/dev/null | sort -t'|' -k4 | head -n ${MAX_LIST_ENTRIES}`,
		"true",
	].join("; ");
	return dockerRun({ volumeName, readOnly: true, script });
}

/**
 * Read one text file, base64-encoded so binary bytes survive the shell, the
 * SSH channel and JSON. The size check happens in the container: a 4 GB file
 * must never be streamed out just to be rejected in Node.
 */
export function buildReadCommand(volumeName: string, path: string): string {
	const script = [
		resolvePrologue(path, "self"),
		'[ -f "$T" ] || exit 46',
		`[ "$(stat -c %s "$T")" -le ${MAX_READ_BYTES} ] || exit 47`,
		'base64 "$T"',
	].join("; ");
	return dockerRun({ volumeName, readOnly: true, script });
}

/**
 * Write a file from base64 on **stdin** (`docker run -i`). The payload never
 * touches argv: a 512 KiB file would blow past Linux's 128 KiB
 * `MAX_ARG_STRLEN` and `ps` would show its contents.
 */
export function buildWriteCommand(volumeName: string, path: string): string {
	const script = [
		resolvePrologue(path, "parent"),
		'[ -d "$T" ] && exit 48',
		'base64 -d > "$T"',
	].join("; ");
	return dockerRun({ volumeName, readOnly: false, interactive: true, script });
}

/**
 * Remove one file, one symlink, or one directory recursively.
 *
 * Resolves the **parent**, not the path itself: `rm -rf` on a resolved
 * symlink would delete what it points at, so deleting a stray
 * `escape -> /etc` inside a volume has to mean "remove the link".
 */
export function buildDeleteCommand(volumeName: string, path: string): string {
	const script = [
		resolvePrologue(path, "parent"),
		// Deleting the mount point itself would wipe the whole volume by
		// accident; the UI has no such button, so treat it as a bug.
		'[ "$T" = "/data" ] && exit 49',
		// `rm -rf` is happy to remove nothing; say so instead.
		'[ -e "$T" ] || [ -L "$T" ] || exit 44',
		'rm -rf -- "$T"',
	].join("; ");
	return dockerRun({ volumeName, readOnly: false, script });
}

/** Create one directory (its parent must already exist). */
export function buildMkdirCommand(volumeName: string, path: string): string {
	const script = [resolvePrologue(path, "parent"), '[ -e "$T" ] && exit 50', 'mkdir "$T"'].join(
		"; ",
	);
	return dockerRun({ volumeName, readOnly: false, script });
}

/* -------------------------------------------------------------------------- */
/*  Output parsing (pure)                                                     */
/* -------------------------------------------------------------------------- */

/** Split a command's stdout into the resolved path and the rest. */
export function splitResolved(stdout: string): { resolved: string; body: string } {
	const newline = stdout.indexOf("\n");
	if (newline === -1) return { resolved: stdout.trim(), body: "" };
	return { resolved: stdout.slice(0, newline).trim(), body: stdout.slice(newline + 1) };
}

const TYPE_BY_STAT: Record<string, VolumeEntryType> = {
	"regular file": "file",
	"regular empty file": "file",
	directory: "directory",
	"symbolic link": "symlink",
};

/**
 * Parse `stat -c '%F|%s|%Y|%n'` lines. The name is the LAST field and may
 * contain `|`, so only the first three separators are significant. Entries
 * whose name contains a newline cannot be represented by this format and are
 * skipped rather than mis-parsed.
 */
export function parseListOutput(body: string, directory: string): VolumeEntry[] {
	const prefix = directory === DATA_MOUNT ? `${DATA_MOUNT}/` : `${directory}/`;
	const entries: VolumeEntry[] = [];
	for (const line of body.split("\n")) {
		if (!line.trim()) continue;
		const first = line.indexOf("|");
		const second = line.indexOf("|", first + 1);
		const third = line.indexOf("|", second + 1);
		if (first === -1 || second === -1 || third === -1) continue;
		const type = line.slice(0, first);
		const size = Number.parseInt(line.slice(first + 1, second), 10);
		const mtime = Number.parseInt(line.slice(second + 1, third), 10);
		const fullName = line.slice(third + 1);
		if (!fullName.startsWith(prefix)) continue;
		const name = fullName.slice(prefix.length);
		if (!name || name.includes("/")) continue;
		entries.push({
			name,
			type: TYPE_BY_STAT[type] ?? "other",
			size: Number.isFinite(size) ? size : 0,
			modifiedAt: Number.isFinite(mtime) ? mtime * 1000 : 0,
		});
	}
	// Directories first, then files, each alphabetically — the order every
	// file manager uses and `sort` alone cannot produce.
	return entries.sort((a, b) => {
		if (a.type === "directory" && b.type !== "directory") return -1;
		if (b.type === "directory" && a.type !== "directory") return 1;
		return a.name.localeCompare(b.name);
	});
}

/** Content that is not displayable text (NUL byte = binary, near enough). */
export function looksBinary(content: Buffer): boolean {
	return content.includes(0);
}

/* -------------------------------------------------------------------------- */
/*  Error mapping                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Exit code of a failed exec, whichever helper threw it: `execAsync`
 * attaches `code`, `execAsyncRemote` throws `RemoteExecError` with
 * `exitCode`, and `execAsyncWithStdin` only puts it in the message.
 */
export function exitCodeOf(error: unknown): number | null {
	const candidate = error as { exitCode?: unknown; code?: unknown; message?: unknown } | null;
	if (typeof candidate?.exitCode === "number") return candidate.exitCode;
	if (typeof candidate?.code === "number") return candidate.code;
	const match =
		typeof candidate?.message === "string" ? candidate.message.match(/\(exit (\d+)\)/) : null;
	return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

/** Exit codes the scripts above use, mapped to DomainErrors the UI can show. */
export function describeVolumeFileError(error: unknown, path: string): Error {
	const code = exitCodeOf(error);
	switch (code) {
		case 44:
			return notFound(`No such file or directory: ${path}`);
		case 45:
			return forbidden(`Path escapes the volume: ${path}`);
		case 46:
			return badRequest(`Not the expected kind of entry: ${path}`);
		case 47:
			return badRequest(
				`File is larger than ${Math.round(MAX_READ_BYTES / 1024)} KiB — download it with a backup instead`,
			);
		case 48:
			return badRequest(`${path} is a directory`);
		case 49:
			return forbidden("Refusing to delete the volume root");
		case 50:
			return badRequest(`${path} already exists`);
		default:
			return error instanceof Error ? error : new Error(String(error));
	}
}

/* -------------------------------------------------------------------------- */
/*  Operations                                                                */
/* -------------------------------------------------------------------------- */

/** Where the throwaway container runs: the Nixploy host, or a managed server. */
export interface VolumeFileTarget {
	volumeName: string;
	serverId?: string | null;
}

/** One browse/read/write operation takes at most this long. */
const VOLUME_COMMAND_TIMEOUT_MS = 60_000;

const run = (serverId: string | null | undefined, command: string): Promise<string> =>
	serverId
		? execAsyncRemote(serverId, command, { timeoutMs: VOLUME_COMMAND_TIMEOUT_MS })
		: execAsync(command, { timeout: VOLUME_COMMAND_TIMEOUT_MS });

/** Directory listing of `path` inside `volumeName`. */
export async function listVolumeFiles(
	target: VolumeFileTarget,
	rawPath: string | null | undefined,
): Promise<{ path: string; entries: VolumeEntry[]; truncated: boolean }> {
	assertVolumeName(target.volumeName);
	const path = normalizeVolumePath(rawPath);
	let stdout: string;
	try {
		stdout = await run(target.serverId, buildListCommand(target.volumeName, path));
	} catch (error) {
		throw describeVolumeFileError(error, path);
	}
	const { resolved, body } = splitResolved(stdout);
	assertResolvedInsideData(resolved);
	const entries = parseListOutput(body, resolved);
	return { path: resolved, entries, truncated: entries.length >= MAX_LIST_ENTRIES };
}

/** Text contents of one file (≤ {@link MAX_READ_BYTES}). */
export async function readVolumeFile(
	target: VolumeFileTarget,
	rawPath: string,
): Promise<{ path: string; content: string; size: number }> {
	assertVolumeName(target.volumeName);
	const path = normalizeVolumePath(rawPath);
	if (path === DATA_MOUNT) {
		throw badRequest("Choose a file to read");
	}
	let stdout: string;
	try {
		stdout = await run(target.serverId, buildReadCommand(target.volumeName, path));
	} catch (error) {
		throw describeVolumeFileError(error, path);
	}
	const { resolved, body } = splitResolved(stdout);
	assertResolvedInsideData(resolved);
	// `base64` wraps at 76 columns; Buffer.from ignores the newlines.
	const content = Buffer.from(body, "base64");
	if (looksBinary(content)) {
		throw badRequest("This file is binary — the editor only opens text files");
	}
	return { path: resolved, content: content.toString("utf8"), size: content.byteLength };
}

/** Create or overwrite one text file. */
export async function writeVolumeFile(
	target: VolumeFileTarget,
	rawPath: string,
	content: string,
): Promise<{ path: string; size: number }> {
	assertVolumeName(target.volumeName);
	const path = normalizeVolumePath(rawPath);
	if (path === DATA_MOUNT) {
		throw badRequest("Choose a file to write");
	}
	const payload = Buffer.from(content, "utf8");
	if (payload.byteLength > MAX_WRITE_BYTES) {
		throw badRequest(`File is larger than ${Math.round(MAX_WRITE_BYTES / 1024)} KiB`);
	}
	let stdout: string;
	try {
		stdout = await execAsyncWithStdin(
			buildWriteCommand(target.volumeName, path),
			payload.toString("base64"),
			{ serverId: target.serverId ?? null, timeout: VOLUME_COMMAND_TIMEOUT_MS },
		);
	} catch (error) {
		throw describeVolumeFileError(error, path);
	}
	const { resolved } = splitResolved(stdout);
	assertResolvedInsideData(resolved);
	return { path: resolved, size: payload.byteLength };
}

/** Remove a file, or a directory and everything under it. */
export async function deleteVolumePath(
	target: VolumeFileTarget,
	rawPath: string,
): Promise<{ path: string }> {
	assertVolumeName(target.volumeName);
	const path = normalizeVolumePath(rawPath);
	if (path === DATA_MOUNT) {
		throw forbidden("Refusing to delete the volume root");
	}
	let stdout: string;
	try {
		stdout = await run(target.serverId, buildDeleteCommand(target.volumeName, path));
	} catch (error) {
		throw describeVolumeFileError(error, path);
	}
	const { resolved } = splitResolved(stdout);
	assertResolvedInsideData(resolved);
	return { path: resolved };
}

/** Create one directory inside the volume. */
export async function makeVolumeDirectory(
	target: VolumeFileTarget,
	rawPath: string,
): Promise<{ path: string }> {
	assertVolumeName(target.volumeName);
	const path = normalizeVolumePath(rawPath);
	if (path === DATA_MOUNT) {
		throw badRequest("Choose a name for the new folder");
	}
	let stdout: string;
	try {
		stdout = await run(target.serverId, buildMkdirCommand(target.volumeName, path));
	} catch (error) {
		throw describeVolumeFileError(error, path);
	}
	const { resolved } = splitResolved(stdout);
	assertResolvedInsideData(resolved);
	return { path: resolved };
}
