import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The policy resolves DNS and reads two instance facts; pin all three so the
// test is offline and deterministic.
vi.mock("node:dns/promises", () => ({
	lookup: vi.fn(async (host: string) => {
		if (host === "old-panel.example.com") return [{ address: "8.8.8.8", family: 4 }];
		if (host === "lan.example.com") return [{ address: "192.168.1.20", family: 4 }];
		if (host === "rebound.example.com") return [{ address: "10.0.1.7", family: 4 }];
		if (host === "self.example.com") return [{ address: "9.9.9.9", family: 4 }];
		throw new Error("ENOTFOUND");
	}),
}));
vi.mock("../cluster/public-host", () => ({
	detectPublicIp: vi.fn(async () => "9.9.9.9"),
}));
vi.mock("../traefik/dashboard", () => ({
	getDashboardDomain: vi.fn(async () => "panel.example.com"),
}));

import { setPrivateEgressAllowedForTests } from "../../utils/public-url";
import { assertUpstreamTargetUrl, UpstreamResolveError } from "./target";

describe("assertUpstreamTargetUrl", () => {
	beforeEach(() => setPrivateEgressAllowedForTests(false));
	afterEach(() => setPrivateEgressAllowedForTests(null));

	it("accepts a public origin and normalises it", async () => {
		await expect(assertUpstreamTargetUrl("https://old-panel.example.com:443/")).resolves.toEqual({
			url: "https://old-panel.example.com",
			isPrivate: false,
		});
		await expect(assertUpstreamTargetUrl("http://8.8.8.8:8080")).resolves.toEqual({
			url: "http://8.8.8.8:8080",
			isPrivate: false,
		});
	});

	it("is an origin only: no path, query, fragment or credentials", async () => {
		await expect(assertUpstreamTargetUrl("https://old-panel.example.com/app")).rejects.toThrow(
			/origin only/,
		);
		await expect(assertUpstreamTargetUrl("https://old-panel.example.com/?x=1")).rejects.toThrow(
			/query string/,
		);
		await expect(assertUpstreamTargetUrl("https://u:p@old-panel.example.com")).rejects.toThrow(
			/credentials/,
		);
		await expect(assertUpstreamTargetUrl("ftp://old-panel.example.com")).rejects.toThrow(
			/http or https/,
		);
		await expect(assertUpstreamTargetUrl("not a url")).rejects.toThrow(/absolute http/);
	});

	it("refuses a bare name — it would resolve to a service on the overlay", async () => {
		await expect(assertUpstreamTargetUrl("http://other-tenant-app:3000")).rejects.toThrow(
			/bare name/,
		);
		await expect(assertUpstreamTargetUrl("http://nixploy:3000")).rejects.toThrow(/bare name/);
	});

	it("refuses the panel's own host and the server's own address", async () => {
		await expect(assertUpstreamTargetUrl("https://panel.example.com")).rejects.toThrow(
			/panel's own address/,
		);
		await expect(assertUpstreamTargetUrl("https://self.example.com")).rejects.toThrow(
			/server's own address/,
		);
		await expect(assertUpstreamTargetUrl("http://9.9.9.9")).rejects.toThrow(/server's own address/);
	});

	it("refuses a name that resolves onto the cluster overlay whatever the toggle says", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(assertUpstreamTargetUrl("http://rebound.example.com")).rejects.toThrow(
			/cluster-internal/,
		);
	});

	it("lets a LAN target through only with private egress on", async () => {
		await expect(assertUpstreamTargetUrl("http://lan.example.com:8080")).rejects.toThrow(
			/private address/,
		);
		setPrivateEgressAllowedForTests(true);
		await expect(assertUpstreamTargetUrl("http://lan.example.com:8080")).resolves.toEqual({
			url: "http://lan.example.com:8080",
			isPrivate: true,
		});
	});

	it("reports a name that does not resolve as transient, not as a policy decision", async () => {
		await expect(assertUpstreamTargetUrl("https://gone.example.com")).rejects.toBeInstanceOf(
			UpstreamResolveError,
		);
	});
});
