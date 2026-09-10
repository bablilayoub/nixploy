import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	inspect: vi.fn(),
	update: vi.fn(),
	createService: vi.fn(),
}));

vi.mock("dockerode", () => {
	class Docker {
		getService() {
			return { inspect: mocks.inspect, update: mocks.update };
		}
		createService = mocks.createService;
		listNetworks = vi.fn().mockResolvedValue([{ Name: "nixploy-network" }]);
		createNetwork = vi.fn();
	}
	return { default: Docker };
});
vi.mock("../../db", () => ({ db: {} }));
vi.mock("../../utils/exec", () => ({ execAsyncRemote: vi.fn() }));
vi.mock("../cluster/swarm-node", () => ({ getServerSwarmNodeId: vi.fn() }));

import { stopDatabase } from "./engine";

const inspection = (version: number, replicas = 1) => ({
	Version: { Index: version },
	Spec: {
		Name: "pg-abc123",
		Labels: { "nixploy.managed": "true", "nixploy.service.type": "postgres" },
		Mode: { Replicated: { Replicas: replicas } },
	},
});

describe("swarm service updates retry on version conflicts", () => {
	beforeEach(() => {
		mocks.inspect.mockReset();
		mocks.update.mockReset();
	});

	it("re-inspects and retries when Swarm answers 'update out of sequence'", async () => {
		// scaleDatabase inspects once for the existence check, then once per attempt.
		mocks.inspect
			.mockResolvedValueOnce(inspection(10))
			.mockResolvedValueOnce(inspection(10))
			.mockResolvedValue(inspection(11));
		mocks.update
			.mockRejectedValueOnce(new Error("rpc error: code = Unknown desc = update out of sequence"))
			.mockResolvedValueOnce(undefined);

		await stopDatabase("pg-abc123");

		expect(mocks.update).toHaveBeenCalledTimes(2);
		expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({ version: 10 });
		expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({
			version: 11,
			Mode: { Replicated: { Replicas: 0 } },
		});
	});

	it("does not retry other errors", async () => {
		mocks.inspect.mockResolvedValue(inspection(10));
		mocks.update.mockRejectedValueOnce(new Error("no such image"));

		await expect(stopDatabase("pg-abc123")).rejects.toThrow("no such image");
		expect(mocks.update).toHaveBeenCalledTimes(1);
	});

	it("gives up after repeated conflicts", async () => {
		mocks.inspect.mockResolvedValue(inspection(10));
		mocks.update.mockRejectedValue(new Error("update out of sequence"));

		await expect(stopDatabase("pg-abc123")).rejects.toThrow("out of sequence");
		expect(mocks.update).toHaveBeenCalledTimes(5);
	});
});
