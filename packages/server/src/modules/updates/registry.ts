/**
 * Parse `registry/repo:tag` or `registry/repo@sha256:…` image references and
 * fetch the remote content digest from an OCI registry (GHCR by default).
 */

export interface ParsedImageRef {
	registry: string;
	repository: string;
	/** Tag when present; null for digest-only refs. */
	tag: string | null;
	/** Digest (sha256:…) when the ref already pins one. */
	digest: string | null;
	/** Canonical `registry/repository:tag` (or `@digest`) used for pulls. */
	canonical: string;
}

const DEFAULT_REGISTRY = "ghcr.io";

/** Strip a leading `docker.io/` / library path quirks; keep GHCR paths intact. */
export function parseImageRef(raw: string): ParsedImageRef {
	let value = raw.trim();
	let digest: string | null = null;
	const at = value.indexOf("@");
	if (at !== -1) {
		digest = value.slice(at + 1);
		value = value.slice(0, at);
	}

	let tag: string | null = "latest";
	const slash = value.lastIndexOf("/");
	const colon = value.lastIndexOf(":");
	if (colon > slash) {
		tag = value.slice(colon + 1) || "latest";
		value = value.slice(0, colon);
	}

	const parts = value.split("/");
	let registry: string;
	let repository: string;
	if (parts.length === 1) {
		registry = "docker.io";
		repository = `library/${parts[0]}`;
	} else if (parts[0]?.includes(".") || parts[0]?.includes(":") || parts[0] === "localhost") {
		registry = parts[0] ?? DEFAULT_REGISTRY;
		repository = parts.slice(1).join("/");
	} else {
		registry = "docker.io";
		repository = value;
	}

	const canonical = digest
		? `${registry}/${repository}@${digest}`
		: `${registry}/${repository}:${tag ?? "latest"}`;

	return { registry, repository, tag: digest ? null : tag, digest, canonical };
}

/** Normalize a digest header / RepoDigest to bare `sha256:…`. */
export function normalizeDigest(value: string | null | undefined): string | null {
	if (!value) return null;
	const match = value.match(/sha256:[a-f0-9]{64}/i);
	return match ? match[0].toLowerCase() : null;
}

function registryEndpoints(ref: ParsedImageRef): { tokenUrl: string; manifestHost: string } {
	const scope = `repository:${ref.repository}:pull`;
	if (ref.registry === "docker.io") {
		return {
			tokenUrl: `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`,
			manifestHost: "registry-1.docker.io",
		};
	}
	if (ref.registry === "ghcr.io") {
		return {
			tokenUrl: `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
			manifestHost: "ghcr.io",
		};
	}
	// LinuxServer's lscr.io is a GHCR front; token must come from ghcr.io.
	if (ref.registry === "lscr.io") {
		return {
			tokenUrl: `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`,
			manifestHost: "lscr.io",
		};
	}
	return {
		tokenUrl: `https://${ref.registry}/token?service=${encodeURIComponent(ref.registry)}&scope=${encodeURIComponent(scope)}`,
		manifestHost: ref.registry,
	};
}

/**
 * Ask the registry for the content digest of a tag without pulling layers.
 * Works for public Docker Hub / GHCR / lscr.io packages (anonymous token).
 */
export async function fetchRemoteDigest(image: string): Promise<string | null> {
	const ref = parseImageRef(image);
	if (ref.digest) return normalizeDigest(ref.digest);
	if (!ref.tag) return null;

	const { tokenUrl, manifestHost } = registryEndpoints(ref);

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		let authHeader: string | undefined;
		try {
			const tokenRes = await fetch(tokenUrl, { signal: controller.signal });
			if (tokenRes.ok) {
				const body = (await tokenRes.json()) as { token?: string; access_token?: string };
				const token = body.token ?? body.access_token;
				if (token) authHeader = `Bearer ${token}`;
			}
		} catch {
			// Some registries allow anonymous pulls without a token dance.
		}

		const manifestUrl = `https://${manifestHost}/v2/${ref.repository}/manifests/${encodeURIComponent(ref.tag)}`;
		const accept = [
			"application/vnd.oci.image.index.v1+json",
			"application/vnd.docker.distribution.manifest.list.v2+json",
			"application/vnd.oci.image.manifest.v1+json",
			"application/vnd.docker.distribution.manifest.v2+json",
		].join(", ");

		let res = await fetch(manifestUrl, {
			method: "GET",
			signal: controller.signal,
			headers: {
				...(authHeader ? { Authorization: authHeader } : {}),
				Accept: accept,
			},
		});

		// Follow WWW-Authenticate when the first token endpoint was wrong (e.g. n8n).
		if (res.status === 401) {
			const www = res.headers.get("www-authenticate") ?? "";
			const realm = /realm="([^"]+)"/.exec(www)?.[1];
			const service = /service="([^"]+)"/.exec(www)?.[1];
			const scope = /scope="([^"]+)"/.exec(www)?.[1] ?? `repository:${ref.repository}:pull`;
			if (realm) {
				const challengeUrl = `${realm}?service=${encodeURIComponent(service ?? ref.registry)}&scope=${encodeURIComponent(scope)}`;
				const tokenRes = await fetch(challengeUrl, { signal: controller.signal });
				if (tokenRes.ok) {
					const body = (await tokenRes.json()) as { token?: string; access_token?: string };
					const token = body.token ?? body.access_token;
					if (token) {
						res = await fetch(manifestUrl, {
							method: "GET",
							signal: controller.signal,
							headers: { Authorization: `Bearer ${token}`, Accept: accept },
						});
					}
				}
			}
		}

		if (!res.ok) return null;
		return (
			normalizeDigest(res.headers.get("docker-content-digest")) ??
			normalizeDigest(res.headers.get("Docker-Content-Digest"))
		);
	} finally {
		clearTimeout(timer);
	}
}
