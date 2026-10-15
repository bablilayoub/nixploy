import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), guard: vi.fn() }));
vi.mock("../../utils/public-url", () => ({
	assertSafeOutboundUrl: mocks.guard,
	pinnedFetch: mocks.fetch,
}));

import { SourcePanelClient } from "./client";

const response = (value: unknown) => ({
	ok: true,
	status: 200,
	json: () => value,
});

describe("source panel client", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.guard.mockResolvedValue({
			url: new URL("https://source.example.com"),
			addresses: ["203.0.113.1"],
			isPrivate: false,
		});
	});

	it("hydrates id-only list summaries from project.one, including inherited environment env", async () => {
		// Dokploy v0.30.8 project.all deliberately omits database names and
		// environment env. Requiring the full detail shape here broke inspect.
		mocks.fetch
			.mockResolvedValueOnce(
				response([
					{
						projectId: "p1",
						name: "Shop",
						environments: [
							{ environmentId: "e1", name: "production", postgres: [{ postgresId: "db1" }] },
						],
					},
				]),
			)
			.mockResolvedValueOnce(
				response({
					projectId: "p1",
					name: "Shop",
					env: "PROJECT_SHARED=1",
					environments: [
						{
							environmentId: "e1",
							name: "production",
							env: "ENV_SHARED=2",
							postgres: [{ postgresId: "db1", name: "main" }],
						},
					],
				}),
			);
		const client = await SourcePanelClient.connect({
			url: "https://source.example.com",
			apiKey: "controlled-test-key",
		});
		const projects = await client.listProjects();
		expect(projects[0]?.environments[0]).toMatchObject({
			env: "ENV_SHARED=2",
			postgres: [{ postgresId: "db1", name: "main" }],
		});
		expect(mocks.fetch.mock.calls.map(([target]) => target.url.pathname)).toEqual([
			"/api/project.all",
			"/api/project.one",
		]);
		expect(mocks.fetch.mock.calls[1]?.[0].url.searchParams.get("projectId")).toBe("p1");
	});

	it("keeps a rejected detail request as an authentication failure", async () => {
		mocks.fetch
			.mockResolvedValueOnce(response([{ projectId: "p1", name: "Shop" }]))
			.mockResolvedValueOnce({ ok: false, status: 403 });
		const client = await SourcePanelClient.connect({
			url: "https://source.example.com",
			apiKey: "controlled-test-key",
		});
		await expect(client.listProjects()).rejects.toThrow(/403 on project.one/);
	});
});
