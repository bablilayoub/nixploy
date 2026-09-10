import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PR preview's Traefik YAML must forward to the PARENT domain's container
 * port (hardcoded 3000 502'd every static/nginx or non-Node app) and carry
 * the parent's basic-auth + redirects (the preview runs production env).
 */

const { state, writeAppTraefikConfig, removeTraefikConfig } = vi.hoisted(() => ({
	state: {
		domain: null as null | Record<string, unknown>,
	},
	writeAppTraefikConfig: vi.fn(async (_input: unknown) => {}),
	removeTraefikConfig: vi.fn(async (_appName: string) => {}),
}));

vi.mock("../../db", () => ({
	db: {
		query: {
			previewDeployments: {
				findFirst: async () => ({
					previewDeploymentId: "prev-1",
					appName: "myapp-pr-7",
					applicationId: "app-1",
				}),
			},
			domains: { findFirst: async () => state.domain },
			redirects: {
				findMany: async () => [{ regex: "^/old$", replacement: "/new", permanent: true }],
			},
			security: { findMany: async () => [{ username: "admin", password: "$2a$10$hash" }] },
		},
	},
}));
vi.mock("../traefik", () => ({
	writeAppTraefikConfig,
	removeTraefikConfig,
	DEFAULT_CONTAINER_PORT: 80,
}));

import { syncPreviewTraefik } from "./traefik";

const domain = (port: number | null) => ({
	host: "pr-7-myapp.example.test",
	path: "/",
	internalPath: null,
	port,
	https: false,
	certificateType: "none",
	certificateId: null,
});

describe("syncPreviewTraefik", () => {
	beforeEach(() => {
		writeAppTraefikConfig.mockClear();
		removeTraefikConfig.mockClear();
	});

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
