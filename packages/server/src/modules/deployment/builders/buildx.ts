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

/**
 * Can this host EXPORT a BuildKit cache (`--cache-to type=local`)?
 *
 * Having buildx is not enough. Its default `docker` driver cannot export a
 * cache unless the daemon runs the containerd image store, and asking anyway
 * fails the build outright with "Cache export is not supported for the docker
 * driver" — which is what every Dockerfile build on a stock Linux Docker did,
 * because the per-app layer cache is on by default. Docker Desktop hides this:
 * it ships the containerd store, so the same build succeeds there.
 *
 * Probed per host and cached like {@link hasBuildx}.
 */
const cacheExportProbes = new Map<string, Promise<boolean>>();

const probeCacheExport = async (serverId: string | null | undefined): Promise<boolean> => {
	if (!(await hasBuildx(serverId))) return false;
	const run = async (cmd: string): Promise<string> =>
		serverId
			? await execAsyncRemote(serverId, cmd, { timeoutMs: 15_000 })
			: await execAsync(cmd, { timeout: 15_000 });
	try {
		// `docker buildx inspect --format` only exists on newer plugins, so read
		// the human output — the "Driver:" line is stable across versions.
		const driver = (
			await run("docker buildx inspect 2>/dev/null | sed -n 's/^Driver:[[:space:]]*//p' | head -1")
		).trim();
		// container / kubernetes / remote drivers all export cache.
		if (driver && driver !== "docker") return true;
		const info = await run("docker info -f '{{.DriverStatus}}' 2>/dev/null");
		return info.includes("io.containerd.snapshotter");
	} catch {
		return false;
	}
};

export async function supportsBuildCacheExport(
	serverId: string | null | undefined,
): Promise<boolean> {
	const key = serverId ?? "local";
	const cached = cacheExportProbes.get(key);
	if (cached) return cached;
	const pending = probeCacheExport(serverId);
	cacheExportProbes.set(key, pending);
	return pending;
}

/** Forget the cached probes (tests, and after a server setup installs buildx). */
export function resetBuildxProbes(): void {
	probes.clear();
	cacheExportProbes.clear();
}

/** Same shape as {@link BUILDX_MISSING_HINT}, for the cache-export case. */
export const CACHE_EXPORT_UNSUPPORTED_HINT =
	'this host\'s buildx uses the default "docker" driver, which cannot export a layer ' +
	"cache. Turn on the containerd image store in the Docker daemon, or create a " +
	"container builder (docker buildx create --name nixploy --driver docker-container --use).";

/** One line telling the operator what they lose and how to get it back. */
export const BUILDX_MISSING_HINT =
	"buildx is not installed on this build host — falling back to the classic builder " +
	"(no layer cache, no BuildKit secrets). Install the docker buildx plugin " +
	"(Alpine: apk add docker-cli-buildx, Debian/Ubuntu: apt install docker-buildx-plugin).";
