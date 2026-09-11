import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchRemoteDigest = vi.fn<(image: string) => Promise<string | null>>();
vi.mock("../updates/registry", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, fetchRemoteDigest: (image: string) => fetchRemoteDigest(image) };
});

import { checkCatalogImages } from "./images";

describe("checkCatalogImages", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fetchRemoteDigest.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries a registry whose connection dropped instead of failing the image", async () => {
		// Regression: one `fetch failed` from lscr.io failed the whole CI catalog
		// check while the same image resolved on the next run.
		fetchRemoteDigest
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce("sha256:abc");
		const pending = checkCatalogImages({ images: ["lscr.io/linuxserver/dokuwiki:latest"] });
		await vi.runAllTimersAsync();
		const [result] = await pending;
		expect(result).toEqual({ image: "lscr.io/linuxserver/dokuwiki:latest", ok: true });
		expect(fetchRemoteDigest).toHaveBeenCalledTimes(3);
	});

	it("reports the last network error when every attempt failed", async () => {
		fetchRemoteDigest.mockRejectedValue(new Error("fetch failed"));
		const pending = checkCatalogImages({ images: ["lscr.io/linuxserver/dokuwiki:latest"] });
		await vi.runAllTimersAsync();
		const [result] = await pending;
		expect(result?.ok).toBe(false);
		expect(result?.error).toMatch(/registry unreachable after 4 attempts: fetch failed/);
	});
});
