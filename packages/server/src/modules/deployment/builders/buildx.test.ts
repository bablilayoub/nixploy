import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execAsync = vi.fn();
const execAsyncRemote = vi.fn();
vi.mock("../../../utils/exec", () => ({
	execAsync: (...args: unknown[]) => execAsync(...args),
	execAsyncRemote: (...args: unknown[]) => execAsyncRemote(...args),
}));

import { hasBuildx, resetBuildxProbes, supportsBuildCacheExport } from "./buildx";

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

describe("supportsBuildCacheExport", () => {
	beforeEach(() => {
		resetBuildxProbes();
		execAsync.mockReset();
		execAsyncRemote.mockReset();
	});
	afterEach(() => resetBuildxProbes());

	/** version probe → buildx inspect → docker info, in that order. */
	const localAnswers = (driver: string, driverStatus: string) => {
		execAsync
			.mockResolvedValueOnce("github.com/docker/buildx v0.37.0")
			.mockResolvedValueOnce(driver)
			.mockResolvedValueOnce(driverStatus);
	};

	it("says no for the default docker driver without the containerd store", async () => {
		// Regression: the per-app layer cache is on by default, and asking the
		// docker driver to export one fails the whole build with "Cache export is
		// not supported for the docker driver" — which is every Dockerfile build
		// on a stock Linux Docker. Docker Desktop hides it by shipping containerd.
		localAnswers("docker\n", "[[driver-type overlayfs]]\n");
		expect(await supportsBuildCacheExport(null)).toBe(false);
	});

	it("says yes when the daemon runs the containerd image store", async () => {
		localAnswers("docker\n", "[[driver-type io.containerd.snapshotter.v1]]\n");
		expect(await supportsBuildCacheExport(null)).toBe(true);
	});

	it("says yes for a container builder", async () => {
		localAnswers("docker-container\n", "");
		expect(await supportsBuildCacheExport(null)).toBe(true);
	});

	it("says no when buildx itself is missing, without probing further", async () => {
		execAsync.mockRejectedValue(new Error("unknown command: docker buildx"));
		expect(await supportsBuildCacheExport(null)).toBe(false);
		expect(execAsync).toHaveBeenCalledTimes(1);
	});

	it("probes once per host", async () => {
		localAnswers("docker-container\n", "");
		expect(await supportsBuildCacheExport(null)).toBe(true);
		expect(await supportsBuildCacheExport(null)).toBe(true);
		// version + inspect + nothing more.
		expect(execAsync).toHaveBeenCalledTimes(2);
	});
});
