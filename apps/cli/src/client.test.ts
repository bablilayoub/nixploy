import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPost } from "./client.js";

/**
 * How the CLI turns a command's input into a request. The REST adapter is
 * strict about shapes — several procedures declare `{ serverId: string | null }`
 * and reject a missing object with "expected object, received undefined" — so
 * these cases are contract, not detail.
 */

const calls: Array<{ url: string; init: RequestInit }> = [];

/** The request the last call made; fails loudly instead of silently skipping. */
function lastCall(): { url: string; init: RequestInit } {
	const call = calls.at(-1);
	if (!call) throw new Error("fetch was never called");
	return call;
}

const lastHeaders = (): Record<string, string> => lastCall().init.headers as Record<string, string>;

const lastUrl = (): URL => new URL(lastCall().url);

function mockFetch(body: unknown, status = 200): void {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: URL | string, init: RequestInit = {}) => {
			calls.push({ url: String(url), init });
			return new Response(body === undefined ? "" : JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			});
		}),
	);
}

beforeEach(() => {
	calls.length = 0;
	// Assigning `undefined` to process.env stringifies to "undefined", so these
	// always have to be deleted rather than reset.
	delete process.env.NIXPLOY_ORG_ID;
	process.env.NIXPLOY_API_URL = "http://panel.test";
	process.env.NIXPLOY_API_KEY = "nxp_test";
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.NIXPLOY_API_URL;
	delete process.env.NIXPLOY_API_KEY;
	delete process.env.NIXPLOY_ORG_ID;
});

describe("apiGet query building", () => {
	it("sends no input when the caller passes none", async () => {
		mockFetch({ result: { data: [] } });
		await apiGet("project.all");
		expect(lastCall().url).toBe("http://panel.test/api/project.all");
	});

	it("sends an empty input object when the caller passes {}", async () => {
		// `{}` is not the same as "no input": a non-optional object schema
		// rejects undefined.
		mockFetch({ result: { data: {} } });
		await apiGet("docker.systemInfo", {});
		expect(lastCall().url).toBe("http://panel.test/api/docker.systemInfo?input=%7B%7D");
	});

	it("flattens a pure string map into query params", async () => {
		mockFetch({ result: { data: [] } });
		await apiGet("application.all", { projectId: "p1", environmentName: "production" });
		const url = lastUrl();
		expect(url.searchParams.get("projectId")).toBe("p1");
		expect(url.searchParams.get("environmentName")).toBe("production");
		expect(url.searchParams.get("input")).toBeNull();
	});

	it("drops undefined fields from a flattened map", async () => {
		mockFetch({ result: { data: [] } });
		await apiGet("application.all", { projectId: "p1", environmentName: undefined });
		const url = lastUrl();
		expect([...url.searchParams.keys()]).toEqual(["projectId"]);
	});

	it("JSON-encodes numbers and booleans so Zod sees the right types", async () => {
		mockFetch({ result: { data: {} } });
		await apiGet("monitoring.history", { appName: "api", hours: 6 });
		const input = lastUrl().searchParams.get("input");
		expect(JSON.parse(input ?? "{}")).toEqual({ appName: "api", hours: 6 });
	});

	it("keeps an explicit null instead of dropping it", async () => {
		// `docker.systemInfo` takes { serverId: string | null }; a dropped null
		// turns into "no input" and a 400.
		mockFetch({ result: { data: {} } });
		await apiGet("docker.systemInfo", { serverId: null });
		const input = lastUrl().searchParams.get("input");
		expect(JSON.parse(input ?? "{}")).toEqual({ serverId: null });
	});
});

describe("request headers and envelope", () => {
	it("sends the API key and the CLI user agent", async () => {
		mockFetch({ result: { data: [] } });
		await apiGet("project.all");
		expect(lastHeaders()["x-api-key"]).toBe("nxp_test");
		expect(lastHeaders()["user-agent"]).toMatch(/^nixploy-cli\//);
		expect(lastHeaders()["x-organization-id"]).toBeUndefined();
	});

	it("adds x-organization-id when an organization is pinned", async () => {
		process.env.NIXPLOY_ORG_ID = "org_abc";
		mockFetch({ result: { data: [] } });
		await apiGet("project.all");
		expect(lastHeaders()["x-organization-id"]).toBe("org_abc");
	});

	it("unwraps the tRPC { result: { data } } envelope", async () => {
		mockFetch({ result: { data: { projectId: "p1" } } });
		await expect(apiGet("project.one", { projectId: "p1" })).resolves.toEqual({ projectId: "p1" });
	});

	it("returns the raw payload when there is no envelope", async () => {
		mockFetch({ ok: true });
		await expect(apiGet("health")).resolves.toEqual({ ok: true });
	});

	it("POSTs the body as JSON with a content-type", async () => {
		mockFetch({ result: { data: { ok: true } } });
		await apiPost("project.create", { name: "shop" });
		expect(lastCall().init.method).toBe("POST");
		expect(lastCall().init.body).toBe(JSON.stringify({ name: "shop" }));
		expect(lastHeaders()["content-type"]).toBe("application/json");
	});
});

describe("error mapping", () => {
	it("throws ApiError carrying the status and the panel's message", async () => {
		mockFetch({ message: 'This action requires the "domains.manage" capability' }, 403);
		await expect(apiGet("domain.all", { projectId: "p1" })).rejects.toMatchObject({
			name: "ApiError",
			status: 403,
			exitCode: 3,
			message: 'This action requires the "domains.manage" capability',
		});
	});

	it("falls back to a status-only message when the body has none", async () => {
		mockFetch({ nope: true }, 500);
		await expect(apiGet("project.all")).rejects.toBeInstanceOf(ApiError);
	});
});
