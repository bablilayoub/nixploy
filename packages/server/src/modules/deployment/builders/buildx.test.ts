import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execAsync = vi.fn();
const execAsyncRemote = vi.fn();
vi.mock("../../../utils/exec", () => ({
	execAsync: (...args: unknown[]) => execAsync(...args),
	execAsyncRemote: (...args: unknown[]) => execAsyncRemote(...args),
}));

import { hasBuildx, resetBuildxProbes } from "./buildx";

describe("hasBuildx", () => {
	beforeEach(() => {
		resetBuildxProbes();
		execAsync.mockReset();
		execAsyncRemote.mockReset();
	});
	afterEach(() => resetBuildxProbes());

	it("reports the plugin missing instead of throwing", async () => {
		// Regression: the published image shipped docker-cli without
		// docker-cli-buildx, so every source build died with "BuildKit is
		// enabled but the buildx component is missing or broken".
		execAsync.mockRejectedValue(new Error("unknown command: docker buildx"));
		expect(await hasBuildx(null)).toBe(false);
	});

	it("probes once per host and reuses the answer", async () => {
		execAsync.mockResolvedValue("github.com/docker/buildx v0.17.1");
		expect(await hasBuildx(null)).toBe(true);
		expect(await hasBuildx(null)).toBe(true);
		expect(execAsync).toHaveBeenCalledTimes(1);

		execAsyncRemote.mockResolvedValue("v0.17.1");
		expect(await hasBuildx("srv_1")).toBe(true);
		expect(execAsyncRemote).toHaveBeenCalledTimes(1);
		expect(execAsyncRemote.mock.calls[0]?.[0]).toBe("srv_1");
	});
});
