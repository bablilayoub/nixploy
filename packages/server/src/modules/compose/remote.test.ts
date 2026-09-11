import { beforeEach, describe, expect, it, vi } from "vitest";

const pinnedFetch = vi.fn();
const assertSafeOutboundUrl = vi.fn();

vi.mock("../../utils/public-url", () => ({
	assertSafeOutboundUrl: (...args: unknown[]) => assertSafeOutboundUrl(...args),
	pinnedFetch: (...args: unknown[]) => pinnedFetch(...args),
}));

const { fetchComposeFromUrl, MAX_REMOTE_COMPOSE_BYTES } = await import("./remote");

const response = (body: string, options: { status?: number; contentType?: string | null } = {}) => {
	const status = options.status ?? 200;
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: "",
		body,
		headers: {
			get: (name: string) => (name === "content-type" ? (options.contentType ?? null) : null),
		},
		text: () => body,
		json: () => JSON.parse(body),
	};
};

beforeEach(() => {
	pinnedFetch.mockReset();
	assertSafeOutboundUrl.mockReset();
	assertSafeOutboundUrl.mockImplementation(async (url: string) => ({
		url: new URL(url),
		addresses: ["93.184.216.34"],
		isPrivate: false,
	}));
});

describe("fetchComposeFromUrl", () => {
	const url = "https://example.com/docker-compose.yml";
	const compose = "services:\n  web:\n    image: traefik/whoami:v1.10\n";

	it("returns the body and caps what it will read", async () => {
		pinnedFetch.mockResolvedValue(response(compose));
		expect(await fetchComposeFromUrl(url)).toBe(compose);
		expect(pinnedFetch.mock.calls[0]?.[1]).toMatchObject({
			maxBytes: MAX_REMOTE_COMPOSE_BYTES,
		});
	});

	it("puts every URL through the egress guard before dialling", async () => {
		pinnedFetch.mockResolvedValue(response(compose));
		await fetchComposeFromUrl(url);
		expect(assertSafeOutboundUrl).toHaveBeenCalledWith(url, { allowPrivate: true });
	});

	it("propagates a guard refusal instead of fetching", async () => {
		assertSafeOutboundUrl.mockRejectedValue(new Error("URL host is not allowed (private address)"));
		await expect(fetchComposeFromUrl("http://169.254.169.254/latest")).rejects.toThrow(
			/not allowed/,
		);
		expect(pinnedFetch).not.toHaveBeenCalled();
	});

	it("explains a redirect rather than following it", async () => {
		pinnedFetch.mockResolvedValue(response("", { status: 302 }));
		await expect(fetchComposeFromUrl(url)).rejects.toThrow(/redirects are not followed/);
	});

	it("rejects an empty file", async () => {
		pinnedFetch.mockResolvedValue(response("   \n "));
		await expect(fetchComposeFromUrl(url)).rejects.toThrow(/empty compose file/);
	});

	it("catches the usual mistake of pasting a repo page URL", async () => {
		pinnedFetch.mockResolvedValue(
			response("<!doctype html><html><body>hi</body></html>", { contentType: "text/html" }),
		);
		await expect(fetchComposeFromUrl(url)).rejects.toThrow(/use the raw file URL/);

		// Even when the server lies about the content type.
		pinnedFetch.mockResolvedValue(response("<html><body>hi</body></html>", { contentType: null }));
		await expect(fetchComposeFromUrl(url)).rejects.toThrow(/use the raw file URL/);
	});

	it("turns a transport failure into a readable message", async () => {
		pinnedFetch.mockRejectedValue(new Error("socket hang up"));
		await expect(fetchComposeFromUrl(url)).rejects.toThrow(
			/Could not fetch the compose file: socket hang up/,
		);
	});
});
