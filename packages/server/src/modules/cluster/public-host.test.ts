import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPublicIp, resetPublicIpCache, resolveLocalPublicHost } from "./public-host";

const originalEnv = { ...process.env };

describe("resolveLocalPublicHost", () => {
	beforeEach(() => {
		resetPublicIpCache();
		delete process.env.NIXPLOY_PUBLIC_HOST;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		process.env = { ...originalEnv };
	});

	it("prefers the explicit NIXPLOY_PUBLIC_HOST", async () => {
		process.env.NIXPLOY_PUBLIC_HOST = " db.example.com ";
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		expect(await resolveLocalPublicHost()).toBe("db.example.com");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("uses the detected public IPv4 in production", async () => {
		// Regression: the external connection URL of a database on the Nixploy
		// host itself said `localhost`, which is wrong for every client outside.
		process.env.NODE_ENV = "production";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("203.0.113.7\n")),
		);
		expect(await resolveLocalPublicHost()).toBe("203.0.113.7");
	});

	it("falls back to localhost in development and when detection fails", async () => {
		process.env.NODE_ENV = "development";
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		expect(await resolveLocalPublicHost()).toBe("localhost");
		expect(fetchSpy).not.toHaveBeenCalled();

		process.env.NODE_ENV = "production";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline");
			}),
		);
		expect(await resolveLocalPublicHost()).toBe("localhost");
	});

	it("caches the detected address and rejects non-IPv4 answers", async () => {
		const fetchSpy = vi.fn(async () => new Response("203.0.113.9"));
		vi.stubGlobal("fetch", fetchSpy);
		expect(await detectPublicIp()).toBe("203.0.113.9");
		expect(await detectPublicIp()).toBe("203.0.113.9");
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		resetPublicIpCache();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("<html>captive portal</html>")),
		);
		expect(await detectPublicIp()).toBeNull();
	});
});
