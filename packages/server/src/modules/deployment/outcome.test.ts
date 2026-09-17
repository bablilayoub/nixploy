import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { swarm } = vi.hoisted(() => ({
	swarm: {
		state: { exists: true, desired: 2, running: 2, pending: 0, failed: 0 },
		fail: false,
	},
}));

vi.mock("../../db", () => ({ db: {} }));
vi.mock("./queue", () => ({ getQueuePosition: () => null }));
vi.mock("../databases/engine", () => ({
	inspectServiceState: async () => {
		if (swarm.fail) throw new Error("docker socket unreachable");
		return swarm.state;
	},
}));

import { domainUrls, readDeploymentHealth, readLogTail } from "./outcome";

beforeEach(() => {
	swarm.state = { exists: true, desired: 2, running: 2, pending: 0, failed: 0 };
	swarm.fail = false;
});

describe("domainUrls", () => {
	it("builds one URL per domain, honouring the scheme and the path", () => {
		expect(
			domainUrls([
				{ host: "app.example.com", path: "/", https: true },
				{ host: "app.example.com", path: "/api", https: true },
				{ host: "legacy.example.com", path: null, https: false },
			]),
		).toEqual([
			"https://app.example.com",
			"https://app.example.com/api",
			"http://legacy.example.com",
		]);
	});

	it("deduplicates and skips a row with no host", () => {
		expect(
			domainUrls([
				{ host: "a.example.com", path: "/", https: true },
				{ host: "a.example.com", path: null, https: true },
				{ host: "", path: "/", https: true },
			]),
		).toEqual(["https://a.example.com"]);
	});
});

describe("readLogTail", () => {
	it("returns the last lines, oldest first, without the blanks", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nixploy-outcome-"));
		const file = join(dir, "build.log");
		await writeFile(file, "one\n\ntwo\nthree\n\n");
		expect(await readLogTail(file, 2)).toEqual(["two", "three"]);
		expect(await readLogTail(file, 10)).toEqual(["one", "two", "three"]);
	});

	it("is empty for a missing file, a null path or a zero count", async () => {
		expect(await readLogTail(join(tmpdir(), "nixploy-does-not-exist.log"), 5)).toEqual([]);
		expect(await readLogTail(null, 5)).toEqual([]);
		expect(await readLogTail("/tmp/anything", 0)).toEqual([]);
	});
});

describe("readDeploymentHealth", () => {
	it("is healthy when every desired replica runs", async () => {
		expect(await readDeploymentHealth("web")).toEqual({
			running: 2,
			desired: 2,
			state: "healthy",
		});
	});

	it("is degraded while only some replicas run", async () => {
		swarm.state = { exists: true, desired: 3, running: 1, pending: 2, failed: 0 };
		expect((await readDeploymentHealth("web")).state).toBe("degraded");
	});

	it("is down when the service exists with nothing running, or does not exist", async () => {
		swarm.state = { exists: true, desired: 2, running: 0, pending: 0, failed: 2 };
		expect((await readDeploymentHealth("web")).state).toBe("down");
		swarm.state = { exists: false, desired: 0, running: 0, pending: 0, failed: 0 };
		expect((await readDeploymentHealth("web")).state).toBe("down");
	});

	it("says unknown — not down — when the daemon cannot be read", async () => {
		// "I could not look" and "nothing is running" are different answers, and
		// reporting the second for the first calls a healthy deploy a failure.
		swarm.fail = true;
		expect((await readDeploymentHealth("web")).state).toBe("unknown");
	});
});
