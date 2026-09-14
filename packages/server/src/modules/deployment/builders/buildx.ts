import { execAsync, execAsyncRemote } from "../../../utils/exec";

/**
 * Is the `buildx` CLI plugin available on a build host?
 *
 * BuildKit is how Nixploy builds images: `docker buildx build` for Dockerfile
 * sources, `--cache-from/--cache-to type=local` for the per-app layer cache,
 * and `--secret` for credential-shaped build args. The plugin is a SEPARATE
 * package from the docker CLI (`docker-cli-buildx` on Alpine/Debian), and the
 * panel image shipped without it until v0.2.7 — every source build failed with
 * "BuildKit is enabled but the buildx component is missing or broken".
 *
 * Remote servers are whatever the operator installed, so this is probed rather
 * than assumed, and the answer is cached per host for the process lifetime
 * (installing a plugin mid-deploy is not a case worth re-probing for).
 */
const probes = new Map<string, Promise<boolean>>();

const probe = async (serverId: string | null | undefined): Promise<boolean> => {
	const cmd = "docker buildx version >/dev/null 2>&1";
	try {
		if (serverId) await execAsyncRemote(serverId, cmd, { timeoutMs: 15_000 });
		else await execAsync(cmd, { timeout: 15_000 });
		return true;
	} catch {
		return false;
	}
};

export async function hasBuildx(serverId: string | null | undefined): Promise<boolean> {
	const key = serverId ?? "local";
	const cached = probes.get(key);
	if (cached) return cached;
	const pending = probe(serverId);
	probes.set(key, pending);
	return pending;
}

/** Forget the cached probes (tests, and after a server setup installs buildx). */
export function resetBuildxProbes(): void {
	probes.clear();
}

/** One line telling the operator what they lose and how to get it back. */
export const BUILDX_MISSING_HINT =
	"buildx is not installed on this build host — falling back to the classic builder " +
	"(no layer cache, no BuildKit secrets). Install the docker buildx plugin " +
	"(Alpine: apk add docker-cli-buildx, Debian/Ubuntu: apt install docker-buildx-plugin).";
