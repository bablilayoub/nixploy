import { realpath } from "node:fs/promises";
import path from "node:path";
import { assertDockerVolumeName } from "../../utils/validators";
import { resolveFileMountPath } from "../application/paths";
import { getConfigDir } from "../deployment/paths";
import { PROTECTED_VOLUMES } from "../docker/protected";
import { badRequest, forbidden } from "../errors";

/**
 * Mount validation shared by the mount router and the GitOps apply. One copy
 * on purpose: a bind mount that the panel refuses must be refused by a
 * manifest too, or the manifest becomes the way around the check.
 */

export type MountType = "bind" | "volume" | "file";

export interface MountShape {
	type: MountType;
	mountPath: string;
	hostPath?: string | null;
	volumeName?: string | null;
	filePath?: string | null;
}

export const BLOCKED_HOST_PATH_PREFIXES = [
	"/var/run/docker.sock",
	"/run/docker.sock",
	"/etc",
	"/root",
	"/proc",
	"/sys",
	"/boot",
	"/dev",
	"/tmp",
	"/var",
	"/run",
	"/home",
	"/Users",
	"/usr",
	"/opt",
	"/srv",
	"/mnt",
	"/media",
	"/data",
	"/nix",
	"/workspace",
	"/Applications",
	"/Library",
	"/System",
	"/private",
] as const;

/**
 * Reject bind mounts that would expose host secrets or the Docker socket.
 * Resolve symlinks via realpath (when the path exists) so `/tmp/sock → docker.sock`
 * cannot bypass the prefix denylist.
 */
export const assertSafeHostPath = async (hostPath: string | null | undefined): Promise<void> => {
	if (!hostPath) return;
	if (hostPath.includes("\0")) {
		throw badRequest("hostPath must not contain null bytes");
	}
	if (!path.isAbsolute(hostPath)) {
		throw badRequest("hostPath must be an absolute path");
	}

	let candidate = path.resolve(hostPath);
	const missing: string[] = [];
	while (candidate !== "/") {
		try {
			candidate = await realpath(candidate);
			break;
		} catch {
			missing.unshift(path.basename(candidate));
			const parent = path.dirname(candidate);
			if (parent === candidate) break;
			candidate = parent;
		}
	}
	if (missing.length > 0) {
		try {
			candidate = path.join(await realpath(candidate), ...missing);
		} catch {
			candidate = path.join(candidate, ...missing);
		}
	}
	const normalized = path.resolve(candidate).replace(/\/+$/, "") || "/";
	if (normalized === "/") {
		throw badRequest("Bind mount hostPath cannot be the filesystem root");
	}
	const blockedPrefixes = [...BLOCKED_HOST_PATH_PREFIXES, path.resolve(getConfigDir())];
	for (const blocked of blockedPrefixes) {
		const blockedNorm = path.resolve(blocked).replace(/\/+$/, "") || "/";
		if (normalized === blockedNorm || normalized.startsWith(`${blockedNorm}/`)) {
			throw badRequest(`Bind mount hostPath is not allowed: ${blockedNorm}`);
		}
	}
};

/** Validate that the fields required by the mount type are present. */
export const validateMountFields = (input: Omit<MountShape, "mountPath">): void => {
	if (input.type === "bind" && !input.hostPath) {
		throw badRequest("hostPath is required for bind mounts");
	}
	if (input.type === "volume" && !input.volumeName) {
		throw badRequest("volumeName is required for volume mounts");
	}
	if (input.type === "file" && !input.filePath) {
		throw badRequest("filePath is required for file mounts");
	}
};

/** A named volume must be a valid Docker name, not a platform volume, and scoped to the app. */
export const assertSafeVolumeName = (
	volumeName: string | null | undefined,
	appName: string,
): void => {
	if (!volumeName) return;
	assertDockerVolumeName(volumeName);
	if (PROTECTED_VOLUMES.has(volumeName)) {
		throw forbidden(`Volume "${volumeName}" is a Nixploy platform volume and cannot be mounted`);
	}
	// Prevent cross-tenant attach: only volumes owned by this app.
	const owned =
		volumeName === appName ||
		volumeName.startsWith(`${appName}_`) ||
		volumeName.startsWith(`${appName}-`);
	if (!owned) {
		throw badRequest(
			`Volume "${volumeName}" must be scoped to this application (name "${appName}", or prefix "${appName}_" / "${appName}-")`,
		);
	}
};

/** Reject file mount paths that escape the application's files directory. */
export const assertSafeFilePath = (appName: string, filePath: string | null | undefined): void => {
	if (!filePath) return;
	try {
		resolveFileMountPath(appName, filePath);
	} catch {
		throw badRequest(`Invalid file mount path: ${filePath}`);
	}
};

/** Every check above, for one mount of `appName`. */
export const assertSafeMount = async (appName: string, mount: MountShape): Promise<void> => {
	validateMountFields(mount);
	if (mount.type === "bind") await assertSafeHostPath(mount.hostPath);
	if (mount.type === "volume") assertSafeVolumeName(mount.volumeName, appName);
	if (mount.type === "file") assertSafeFilePath(appName, mount.filePath);
};
