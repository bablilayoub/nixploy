import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("./config-writer", () => ({ writeFileOnServer: vi.fn() }));

import {
	buildDashboardRouterYaml,
	DASHBOARD_HEADERS_MIDDLEWARE,
	DASHBOARD_HSTS_SECONDS,
	normalizeDashboardDomain,
} from "./dashboard";

type Router = {
	rule: string;
	entryPoints: string[];
	service: string;
	middlewares?: string[];
	priority?: number;
	tls: Record<string, unknown>;
};
type Config = {
	http: {
		routers: Record<string, Router>;
		middlewares: Record<string, Record<string, Record<string, unknown>>>;
		services: Record<string, unknown>;
	};
};

const load = (domain: string | null) =>
	parse(buildDashboardRouterYaml(domain, "http://nixploy:3000")) as Config;

describe("buildDashboardRouterYaml", () => {
	it("serves everything through one priority-1 catch-all until a domain is set", () => {
		const { http } = load(null);
		expect(Object.keys(http.routers)).toEqual(["nixploy-dashboard"]);
		const catchAll = http.routers["nixploy-dashboard"];
		expect(catchAll?.rule).toBe("PathPrefix(`/`)");
		expect(catchAll?.priority).toBe(1);
		expect(catchAll?.entryPoints).toEqual(["websecure"]);
		expect(catchAll?.service).toBe("nixploy-dashboard");
		expect(http.services["nixploy-dashboard"]).toEqual({
			loadBalancer: { servers: [{ url: "http://nixploy:3000" }] },
		});
	});

	it("drops the catch-all once a dashboard domain is configured", () => {
		const { http } = load("panel.example.com");
		// The panel must not answer on every hostname pointed at the box once
		// its own host is known (security.md §2.10).
		expect(Object.keys(http.routers)).not.toContain("nixploy-dashboard");
		expect(Object.values(http.routers).map((router) => router.rule)).not.toContain(
			"PathPrefix(`/`)",
		);
		// The service stays — tenant `maintenance` middlewares point at it.
		expect(http.services["nixploy-dashboard"]).toBeDefined();
	});

	it("routes the configured domain with Let's Encrypt and HSTS", () => {
		const { http } = load("panel.example.com");
		expect(Object.keys(http.routers)).toEqual(["nixploy-dashboard-domain"]);
		const router = http.routers["nixploy-dashboard-domain"];
		expect(router?.rule).toBe("Host(`panel.example.com`)");
		expect(router?.middlewares).toContain(DASHBOARD_HEADERS_MIDDLEWARE);
		expect(router?.tls).toEqual({ certResolver: "letsencrypt" });
	});

	it("never puts a buffering middleware in front of the panel", () => {
		// Traefik's buffering middleware buffers responses too, and oxy answers
		// `500 Internal Server Error` for any EMPTY body — it broke the GitHub
		// App callback's redirect and every 204/empty 404 on a live install
		// (2026-09-14). Request size is capped by the app instead.
		for (const domain of [null, "panel.example.com"]) {
			const yaml = buildDashboardRouterYaml(domain, "http://nixploy:3000");
			expect(yaml, String(domain)).not.toContain("buffering");
			expect(yaml, String(domain)).not.toContain("maxRequestBodyBytes");
		}
	});

	it("declares HSTS without subdomains or preload, and nothing else", () => {
		const { http } = load(null);
		expect(http.middlewares[DASHBOARD_HEADERS_MIDDLEWARE]).toEqual({
			headers: {
				stsSeconds: DASHBOARD_HSTS_SECONDS,
				stsIncludeSubdomains: false,
				stsPreload: false,
			},
		});
		expect(DASHBOARD_HSTS_SECONDS).toBe(31_536_000);
		// One panel middleware exists — nothing here can leak onto tenant routers.
		expect(Object.keys(http.middlewares)).toEqual([DASHBOARD_HEADERS_MIDDLEWARE]);
	});
});

describe("normalizeDashboardDomain", () => {
	it("strips scheme, path and port and lowercases", () => {
		expect(normalizeDashboardDomain("https://Panel.Example.com:443/login")).toBe(
			"panel.example.com",
		);
	});

	it("rejects empty and invalid hosts", () => {
		expect(normalizeDashboardDomain("")).toBeNull();
		expect(normalizeDashboardDomain(null)).toBeNull();
		expect(normalizeDashboardDomain("localhost")).toBeNull();
		expect(normalizeDashboardDomain("-bad.example.com")).toBeNull();
	});
});
