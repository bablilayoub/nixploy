import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), fetch: vi.fn() }));
vi.mock("../../utils/public-url", () => ({
	assertSafeOutboundUrl: mocks.guard,
	pinnedFetch: mocks.fetch,
}));

import { CoolifySourceReader } from "./coolify-reader";

const response = (value: unknown) => ({ ok: true, status: 200, json: () => value });
beforeEach(() => {
	vi.resetAllMocks();
	mocks.guard.mockResolvedValue({
		url: new URL("https://source.example.test/base?discard=token"),
		addresses: ["93.184.216.34"],
		isPrivate: false,
	});
});
const connect = () =>
	CoolifySourceReader.connect({
		url: "https://source.example.test/base?discard=token",
		apiKey: "TRANSIENT_API_KEY_CANARY",
	});

describe("CoolifySourceReader", () => {
	it("hydrates official project/environment inventories and counts unsupported engines without misclassifying them", async () => {
		mocks.fetch
			.mockResolvedValueOnce(response([{ uuid: "p1", name: "Source" }]))
			.mockResolvedValueOnce(
				response([
					{
						uuid: "unsupported1",
						name: "Keydb",
						database_type: "standalone-keydb",
						environment_id: 4,
					},
				]),
			)
			.mockResolvedValueOnce(
				response({
					uuid: "p1",
					name: "Source",
					environments: [{ uuid: "env1", name: "production" }],
				}),
			)
			.mockResolvedValueOnce(
				response({
					id: 4,
					uuid: "env1",
					name: "production",
					applications: [
						{ uuid: "app1", name: "Image", build_pack: "dockerimage" },
						{ uuid: "stack1", name: "Repository stack", build_pack: "dockercompose" },
					],
					services: [{ uuid: "svc1", name: "Compose" }],
					postgresqls: [{ uuid: "db1", name: "Postgres" }],
				}),
			);
		const reader = await connect();
		const projects = await reader.listProjects();
		expect(projects[0]?.environments[0]).toMatchObject({
			applications: [{ applicationId: "app1", name: "Image" }],
			compose: [{ composeId: "service:svc1", name: "Compose" }],
			postgres: [{ postgresId: "db1", name: "Postgres" }],
			libsql: [],
			unsupportedResources: [
				{ id: "stack1", name: "Repository stack", kind: "application (dockercompose)" },
				{ id: "unsupported1", name: "Keydb", kind: "standalone-keydb" },
			],
		});
		expect(mocks.fetch.mock.calls.map(([target]) => target.url.pathname)).toEqual([
			"/api/v1/projects",
			"/api/v1/databases",
			"/api/v1/projects/p1",
			"/api/v1/projects/p1/env1",
		]);
		for (const [target, init] of mocks.fetch.mock.calls) {
			expect(target.addresses).toEqual(["93.184.216.34"]);
			expect(target.url.search).toBe("");
			expect(init).toMatchObject({
				method: "GET",
				timeoutMs: 30000,
				headers: { authorization: "Bearer TRANSIENT_API_KEY_CANARY" },
			});
		}
		expect(JSON.stringify({ projects, notes: reader.getNotes() })).not.toContain(
			"TRANSIENT_API_KEY_CANARY",
		);
	});
	it("does not dial if the egress guard refuses the source", async () => {
		mocks.guard.mockRejectedValue(new Error("source host is blocked"));
		await expect(connect()).rejects.toThrow(/blocked/);
		expect(mocks.fetch).not.toHaveBeenCalled();
	});
	it.each([301, 401, 403, 429, 500])(
		"reports HTTP %s without copying an untrusted response body",
		async (status) => {
			mocks.fetch.mockResolvedValue({
				ok: false,
				status,
				json: () => ({ message: "RESPONSE_SECRET_CANARY" }),
			});
			const reader = await connect();
			await expect(reader.listProjects()).rejects.not.toThrow(/RESPONSE_SECRET_CANARY/);
		},
	);
	it("marks redacted environment fields unavailable and preserves raw source settings", async () => {
		mocks.fetch
			.mockResolvedValueOnce(
				response({
					uuid: "app1",
					name: "Image",
					build_pack: "dockerimage",
					docker_registry_image_name: "nginx",
				}),
			)
			.mockResolvedValueOnce(
				response([{ key: "TOKEN", is_runtime: true, is_buildtime: true, is_preview: false }]),
			);
		const reader = await connect();
		const row = await reader.getApplication("app1");
		expect(row.unavailableFields).toEqual(
			expect.arrayContaining(["env", "buildArgs", "mounts", "ports"]),
		);
		expect(
			reader.getNotes().some((note) => note.message.includes("Existing target values are kept")),
		).toBe(true);
	});
	it("refuses a changed database kind after inspection", async () => {
		mocks.fetch.mockResolvedValueOnce(
			response({ uuid: "db1", name: "db", database_type: "standalone-redis" }),
		);
		const reader = await connect();
		await expect(reader.getDatabase("postgres", "db1")).rejects.toThrow(/type changed/);
	});
	it("does not expose a token-bearing transport error or malformed source response", async () => {
		const reader = await connect();
		mocks.fetch.mockRejectedValueOnce(new Error("TRANSIENT_API_KEY_CANARY"));
		await expect(reader.listProjects()).rejects.toThrow("Could not reach the Coolify API");
		mocks.fetch.mockResolvedValueOnce(response({ error: "SOURCE_RESPONSE_SECRET_CANARY" }));
		await expect(reader.listProjects()).rejects.toThrow("unexpected projects response");
	});
});
