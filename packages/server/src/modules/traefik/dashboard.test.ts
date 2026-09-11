import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("./config-writer", () => ({ writeFileOnServer: vi.fn() }));

import {
	buildDashboardRouterYaml,
	DASHBOARD_BUFFERING_MIDDLEWARE,
	DASHBOARD_HEADERS_MIDDLEWARE,
	DASHBOARD_HSTS_SECONDS,
	DASHBOARD_MAX_REQUEST_BODY_BYTES,
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
	it("keeps the priority-1 catch-all and adds a buffered /api/ sibling above it", () => {
		const { http } = load(null);
		expect(Object.keys(http.routers).sort()).toEqual([
			"nixploy-dashboard",
			"nixploy-dashboard-api",
		]);
		const catchAll = http.routers["nixploy-dashboard"];
		const api = http.routers["nixploy-dashboard-api"];
		expect(catchAll?.rule).toBe("PathPrefix(`/`)");
		expect(catchAll?.priority).toBe(1);
		expect(api?.rule).toBe("PathPrefix(`/api/`) && !PathPrefix(`/api/mcp`)");
		expect(api?.priority).toBe(2);
		for (const router of Object.values(http.routers)) {
			expect(router.entryPoints).toEqual(["websecure"]);
			expect(router.service).toBe("nixploy-dashboard");
		}
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

	it("puts HSTS on every dashboard router and the body cap on the API routers only", () => {
		const { http } = load("panel.example.com");
		expect(Object.keys(http.routers).sort()).toEqual([
			"nixploy-dashboard-domain",
			"nixploy-dashboard-domain-api",
		]);
		for (const [name, router] of Object.entries(http.routers)) {
			expect(router.middlewares, name).toContain(DASHBOARD_HEADERS_MIDDLEWARE);
			if (name.endsWith("-api")) {
				expect(router.middlewares, name).toContain(DASHBOARD_BUFFERING_MIDDLEWARE);
			} else {
				expect(router.middlewares, name).not.toContain(DASHBOARD_BUFFERING_MIDDLEWARE);
			}
		}
		expect(http.routers["nixploy-dashboard-domain"]?.rule).toBe("Host(`panel.example.com`)");
		expect(http.routers["nixploy-dashboard-domain-api"]?.rule).toBe(
			"Host(`panel.example.com`) && PathPrefix(`/api/`) && !PathPrefix(`/api/mcp`)",
		);
		expect(http.routers["nixploy-dashboard-domain"]?.tls).toEqual({ certResolver: "letsencrypt" });
		expect(http.routers["nixploy-dashboard-domain-api"]?.tls).toEqual({
			certResolver: "letsencrypt",
		});
	});

	it("declares HSTS without subdomains/preload and a 4 MiB request buffer", () => {
		const { http } = load(null);
		expect(http.middlewares[DASHBOARD_HEADERS_MIDDLEWARE]).toEqual({
			headers: {
				stsSeconds: DASHBOARD_HSTS_SECONDS,
				stsIncludeSubdomains: false,
				stsPreload: false,
			},
		});
		expect(DASHBOARD_HSTS_SECONDS).toBe(31_536_000);
		expect(http.middlewares[DASHBOARD_BUFFERING_MIDDLEWARE]).toEqual({
			buffering: { maxRequestBodyBytes: DASHBOARD_MAX_REQUEST_BODY_BYTES },
		});
		expect(DASHBOARD_MAX_REQUEST_BODY_BYTES).toBe(4_194_304);
		// Only the two panel middlewares exist — nothing here can leak onto tenant routers.
		expect(Object.keys(http.middlewares).sort()).toEqual(
			[DASHBOARD_BUFFERING_MIDDLEWARE, DASHBOARD_HEADERS_MIDDLEWARE].sort(),
		);
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
