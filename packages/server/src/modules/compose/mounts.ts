import type { ComposeFileSpec, ComposeServiceSpec } from "./parse";

/**
 * Mounts a compose stack gets from its Nixploy `mount` rows.
 *
 * Compose files may not declare bind mounts of their own (`safety.ts` refuses
 * them: a tenant-authored path would be the host filesystem). Rows in the
 * `mount` table are different — they were validated when they were saved, bind
 * paths are instance-admin only, and file mounts are materialized by Nixploy
 * into the service's own files directory. So they are injected AFTER the
 * safety check, exactly like the network and hardening passes, rather than
 * being written into the file the tenant edits.
 *
 * A stack has many containers, so every mount names the service it belongs to.
 */

/** One mount row, reduced to what the injection needs. */
export interface ComposeMount {
	/** Service of the stack this mount attaches to (raw name, before any suffix). */
	serviceName: string;
	type: "bind" | "volume" | "file";
	/** `volume`: the named volume. */
	volumeName?: string | null;
	/** `bind`: absolute host path. `file`: the materialized absolute path. */
	hostPath?: string | null;
	/** Path inside the container. */
	mountPath: string;
}

/** Compose long-form mount entry, which is unambiguous where the short form is not. */
interface LongFormMount {
	type: "bind" | "volume";
	source: string;
	target: string;
}

function toEntry(mount: ComposeMount): LongFormMount | null {
	if (mount.type === "volume") {
		if (!mount.volumeName) return null;
		return { type: "volume", source: mount.volumeName, target: mount.mountPath };
	}
	// `bind` and `file` both land as a host path; `file` differs only in that
	// Nixploy wrote the file there first.
	if (!mount.hostPath) return null;
	return { type: "bind", source: mount.hostPath, target: mount.mountPath };
}

/**
 * Add each mount to its service and declare any named volumes the stack does
 * not already define.
 *
 * `serviceNameFor` maps a raw service name to the name it has in the rendered
 * spec, because isolated stacks suffix every service. Mounts naming a service
 * that is not in the file are dropped — the file is the authority on what
 * exists, and a stale row must not fail a deploy.
 */
export function injectComposeMounts(
	spec: ComposeFileSpec,
	mounts: readonly ComposeMount[],
	serviceNameFor: (rawName: string) => string = (name) => name,
): ComposeFileSpec {
	if (mounts.length === 0) return spec;

	const services: Record<string, ComposeServiceSpec> = { ...(spec.services ?? {}) };
	const namedVolumes = new Set<string>();
	let changed = false;

	for (const mount of mounts) {
		const target = serviceNameFor(mount.serviceName);
		const service = services[target];
		if (!service) continue;
		const entry = toEntry(mount);
		if (!entry) continue;

		const existing = Array.isArray(service.volumes) ? service.volumes : [];
		services[target] = { ...service, volumes: [...existing, entry] };
		if (entry.type === "volume") namedVolumes.add(entry.source);
		changed = true;
	}
	if (!changed) return spec;

	const volumes: Record<string, unknown> =
		spec.volumes && typeof spec.volumes === "object" && !Array.isArray(spec.volumes)
			? { ...(spec.volumes as Record<string, unknown>) }
			: {};
	for (const name of namedVolumes) {
		// A volume the file already declares keeps its own definition (it may
		// carry a driver or labels); anything new gets compose's default.
		if (!(name in volumes)) volumes[name] = null;
	}

	return { ...spec, services, volumes };
}
