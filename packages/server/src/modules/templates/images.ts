import { fetchRemoteDigest, parseImageRef } from "../updates/registry";
import { templates } from "./catalog";

/** Match `image: foo/bar:tag` / quoted variants in compose YAML. */
const IMAGE_LINE = /^\s*image:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/gm;

export function extractImagesFromCompose(compose: string): string[] {
	const images: string[] = [];
	for (const match of compose.matchAll(IMAGE_LINE)) {
		const image = match[1]?.trim();
		if (image) images.push(image);
	}
	return images;
}

/** Unique image refs across the whole template catalog. */
export function listCatalogImages(): string[] {
	const set = new Set<string>();
	for (const template of templates) {
		for (const image of extractImagesFromCompose(template.compose)) {
			set.add(image);
		}
	}
	return [...set].sort();
}

export type ImageHealthResult = {
	image: string;
	ok: boolean;
	error?: string;
};

const CONCURRENCY = 4;
const MAX_RETRIES = 4;

async function sleep(ms: number) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Docker Hub's Hub API (not the registry API) — far less aggressive anonymous
 * rate limits than `registry-1.docker.io` manifests.
 */
async function dockerHubTagExists(
	repository: string,
	tag: string,
): Promise<"ok" | "missing" | "rate"> {
	const url = `https://hub.docker.com/v2/repositories/${repository}/tags/${encodeURIComponent(tag)}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await fetch(url, { signal: controller.signal, redirect: "error" });
		if (res.status === 200) return "ok";
		if (res.status === 404) return "missing";
		if (res.status === 429) return "rate";
		return "missing";
	} finally {
		clearTimeout(timer);
	}
}

async function imageExists(image: string): Promise<{ ok: boolean; error?: string }> {
	const ref = parseImageRef(image);
	if (ref.digest) return { ok: true };
	if (!ref.tag) return { ok: false, error: "image ref has no tag or digest" };

	// docker.n8n.io fronts Docker Hub for n8nio/* — prefer the Hub tag API.
	const hubRepo =
		ref.registry === "docker.io" || ref.registry === "docker.n8n.io" ? ref.repository : null;

	let lastNetworkError: string | null = null;
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			if (hubRepo) {
				const status = await dockerHubTagExists(hubRepo, ref.tag);
				if (status === "ok") return { ok: true };
				if (status === "missing") {
					return { ok: false, error: "tag not found on Docker Hub" };
				}
				await sleep(1_500 * 2 ** attempt);
				continue;
			}

			const digest = await fetchRemoteDigest(image);
			if (digest) return { ok: true };
			if (attempt + 1 < MAX_RETRIES) {
				await sleep(1_000 * 2 ** attempt);
				continue;
			}
			return { ok: false, error: "manifest not found or registry returned non-OK" };
		} catch (error) {
			// A dropped connection or a timed-out registry (`fetch failed`,
			// ECONNRESET, abort) is transient: retry like a rate limit instead
			// of failing the whole catalog check on one flaky mirror.
			lastNetworkError = error instanceof Error ? error.message : String(error);
			if (attempt + 1 < MAX_RETRIES) {
				await sleep(1_000 * 2 ** attempt);
			}
		}
	}

	return {
		ok: false,
		error: lastNetworkError
			? `registry unreachable after ${MAX_RETRIES} attempts: ${lastNetworkError}`
			: "rate limited after retries",
	};
}

/**
 * Probe every catalog image without pulling layers.
 * Docker Hub uses the Hub tag API; other registries use OCI manifests.
 */
export async function checkCatalogImages(options?: {
	images?: string[];
	concurrency?: number;
}): Promise<ImageHealthResult[]> {
	const images = options?.images ?? listCatalogImages();
	const concurrency = options?.concurrency ?? CONCURRENCY;
	const results: ImageHealthResult[] = [];
	let index = 0;

	async function worker() {
		while (index < images.length) {
			const current = images[index++];
			if (!current) continue;
			try {
				const result = await imageExists(current);
				results.push({ image: current, ...result });
			} catch (error) {
				results.push({
					image: current,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, () => worker()));
	return results.sort((a, b) => a.image.localeCompare(b.image));
}
