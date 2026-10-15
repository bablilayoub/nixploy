import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ apiPost: vi.fn(), apiUpload: vi.fn() }));
vi.mock("../client.js", () => client);

import { setOutputMode } from "../utils/output.js";
import { importCommand } from "./import";

afterEach(() => {
	delete process.env.NIXPLOY_IMPORT_API_KEY;
	setOutputMode({});
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("import apply", () => {
	it("prints partial results in JSON while preserving a failure exit", async () => {
		process.env.NIXPLOY_IMPORT_API_KEY = "test-source-key";
		setOutputMode({ json: true });
		const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		client.apiPost.mockResolvedValue({
			result: {
				applied: 1,
				errors: [{ kind: "compose", name: "stack", message: "Review required" }],
			},
		});
		await expect(
			importCommand().parseAsync(
				[
					"apply",
					"--source",
					"dokploy",
					"--url",
					"https://source.test",
					"--source-project",
					"project",
					"--service",
					"application/web",
					"--service",
					"compose/stack",
					"--review-token",
					"a".repeat(64),
				],
				{ from: "user" },
			),
		).rejects.toMatchObject({ exitCode: 1 });
		expect(write.mock.calls[0]?.[0]).toContain('"applied": 1');
		expect(client.apiPost).toHaveBeenCalledWith(
			"import.runApply",
			expect.objectContaining({
				serviceIds: ["application/web", "compose/stack"],
				reviewToken: "a".repeat(64),
			}),
		);
	});
});
