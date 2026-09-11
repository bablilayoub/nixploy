import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PR preview's Traefik YAML must forward to the PARENT domain's container
 * port (hardcoded 3000 502'd every static/nginx or non-Node app) and carry
 * the parent's basic-auth + redirects (the preview runs production env).
 *
 * A compose preview writes one file per exposed compose service, keyed by the
 * PREVIEW project (`<app>-pr-<n>-<service>`), so production's own files are
 * never touched.
 */

const { state, writeAppTraefikConfig, removeTraefikConfig } = vi.hoisted(() => ({
	state: {
		preview: {
			previewDeploymentId: "prev-1",
			appName: "myapp-pr-7",
			applicationId: "app-1" as string | null,
			composeId: null as string | null,
		},
		compose: {
			composeId: "cmp-1",
			composeType: "docker-compose" as "docker-compose" | "stack",
			serverId: null as string | null,
		},
		domain: null as null | Record<string, unknown>,
		domains: [] as Array<Record<string, unknown>>,
		redirects: [] as Array<Record<string, unknown>>,
		security: [] as Array<Record<string, unknown>>,
	},
	writeAppTraefikConfig: vi.fn(async (_input: unknown) => {}),
	removeTraefikConfig: vi.fn(async (_appName: string, _serverId?: string | null) => {}),
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			previewDeployments: { findFirst: async () => state.preview },
			compose: { findFirst: async () => state.compose },
			domains: {
				findFirst: async () => state.domain,
				findMany: async () => state.domains,
			},
			redirects: { findMany: async () => state.redirects },
			security: { findMany: async () => state.security },
		},
	},
}));
vi.mock("../traefik", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		// The real `toTraefikDomainEntry` mapper (and its default port) runs;
		// only the writer side effects are stubbed.
		...actual,
		writeAppTraefikConfig,
		removeTraefikConfig,
	};
});

import { removePreviewTraefik, syncPreviewTraefik } from "./traefik";

const domain = (port: number | null, overrides: Record<string, unknown> = {}) => ({
	host: "pr-7-myapp.example.test",
	path: "/",
	internalPath: null,
	port,
	https: false,
	certificateType: "none",
	certificateId: null,
	serviceName: null,
	...overrides,
});

beforeEach(() => {
	writeAppTraefikConfig.mockClear();
	removeTraefikConfig.mockClear();
	state.preview = {
		previewDeploymentId: "prev-1",
		appName: "myapp-pr-7",
		applicationId: "app-1",
		composeId: null,
	};
	state.compose = { composeId: "cmp-1", composeType: "docker-compose", serverId: null };
	state.domain = null;
	state.domains = [];
	state.redirects = [{ regex: "^/old$", replacement: "/new", permanent: true, serviceName: null }];
	state.security = [{ username: "admin", password: "$2a$10$hash", serviceName: null }];
});

describe("syncPreviewTraefik (application)", () => {
	it("routes to the parent's container port with the parent's auth and redirects", async () => {
		state.domain = domain(8080);
		await syncPreviewTraefik("prev-1");
		expect(writeAppTraefikConfig).toHaveBeenCalledTimes(1);
		const input = writeAppTraefikConfig.mock.calls[0]?.[0] as unknown as {
			appName: string;
			domains: Array<{ port: number }>;
			basicAuth: unknown[];
			redirects: unknown[];
		};
		expect(input.appName).toBe("myapp-pr-7");
		expect(input.domains[0]?.port).toBe(8080);
		expect(input.basicAuth).toEqual([{ username: "admin", password: "$2a$10$hash" }]);
		expect(input.redirects).toEqual([{ regex: "^/old$", replacement: "/new", permanent: true }]);
	});

	it("falls back to the shared default port, never a hardcoded 3000", async () => {
		state.domain = domain(null);
		await syncPreviewTraefik("prev-1");
		const input = writeAppTraefikConfig.mock.calls[0]?.[0] as unknown as {
			domains: Array<{ port: number }>;
		};
		expect(input.domains[0]?.port).toBe(80);
	});

	it("removes the preview's own file when its domain row is gone", async () => {
		state.domain = null;
		await syncPreviewTraefik("prev-1");
		expect(writeAppTraefikConfig).not.toHaveBeenCalled();
		expect(removeTraefikConfig).toHaveBeenCalledWith("myapp-pr-7");
	});
});

describe("syncPreviewTraefik (compose)", () => {
	beforeEach(() => {
		state.preview = {
			previewDeploymentId: "prev-2",
			appName: "shop-pr-7",
			applicationId: null,
			composeId: "cmp-1",
		};
	});

	it("writes one file per exposed service, keyed by the preview project", async () => {
		state.domains = [
			domain(8080, { host: "pr-7-shop-web.example.test", serviceName: "web" }),
			domain(3000, { host: "pr-7-shop-api.example.test", serviceName: "api" }),
		];
		state.redirects = [
			{ regex: "^/old$", replacement: "/new", permanent: true, serviceName: "web" },
		];
		state.security = [{ username: "admin", password: "$2a$10$hash", serviceName: "api" }];

		await syncPreviewTraefik("prev-2");
		expect(writeAppTraefikConfig).toHaveBeenCalledTimes(2);
		const calls = writeAppTraefikConfig.mock.calls.map(
			(call) =>
				call[0] as unknown as {
					appName: string;
					domains: Array<{ host: string; port: number; serviceName: string | null }>;
					redirects: unknown[];
					basicAuth: unknown[];
				},
		);
		// Preview project name, never production's `shop-web` / `shop-api`.
		expect(calls.map((call) => call.appName)).toEqual(["shop-pr-7-web", "shop-pr-7-api"]);
		expect(calls[0]?.domains[0]?.host).toBe("pr-7-shop-web.example.test");
		// The config key already is the container's network alias; leaving
		// `serviceName` set makes the writer forward to `<key>-<svc>-1`, which
		// resolves nowhere (the 502 the live check found on production too).
		expect(calls[0]?.domains[0]?.serviceName).toBeNull();
		// Redirects and basic-auth are per compose SERVICE, not per project.
		expect(calls[0]?.redirects).toHaveLength(1);
		expect(calls[0]?.basicAuth).toHaveLength(0);
		expect(calls[1]?.redirects).toHaveLength(0);
		expect(calls[1]?.basicAuth).toEqual([{ username: "admin", password: "$2a$10$hash" }]);
	});

	it("uses the swarm key shape for stack rows", async () => {
		state.compose.composeType = "stack";
		state.domains = [domain(80, { host: "pr-7-shop-web.example.test", serviceName: "web" })];
		await syncPreviewTraefik("prev-2");
		const [written] = (writeAppTraefikConfig.mock.calls[0] ?? []) as unknown as [
			{ appName: string },
		];
		expect(written.appName).toBe("shop-pr-7_web");
	});

	it("writes nothing when no compose service has a domain", async () => {
		state.domains = [];
		await syncPreviewTraefik("prev-2");
		expect(writeAppTraefikConfig).not.toHaveBeenCalled();
	});
});

describe("removePreviewTraefik", () => {
	it("removes the single file of an application preview", async () => {
		await removePreviewTraefik({
			previewDeploymentId: "prev-1",
			appName: "myapp-pr-7",
			composeId: null,
		});
		expect(removeTraefikConfig).toHaveBeenCalledWith("myapp-pr-7");
	});

	it("removes every per-service file of a compose preview", async () => {
		state.domains = [domain(80, { serviceName: "web" }), domain(80, { serviceName: "api" })];
		await removePreviewTraefik({
			previewDeploymentId: "prev-2",
			appName: "shop-pr-7",
			composeId: "cmp-1",
		});
		const removed = removeTraefikConfig.mock.calls.map((call) => call[0]);
		expect(removed).toContain("shop-pr-7-web");
		expect(removed).toContain("shop-pr-7-api");
		// Never production's.
		expect(removed).not.toContain("shop-web");
	});
});
