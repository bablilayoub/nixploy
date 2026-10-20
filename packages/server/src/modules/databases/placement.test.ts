import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getDocker: vi.fn(),
	info: vi.fn(),
	node: vi.fn(),
	recorded: vi.fn(),
}));
vi.mock("../deployment/docker", () => ({ getDocker: mocks.getDocker }));
vi.mock("../cluster/swarm-node", () => ({ getServerSwarmNodeId: mocks.recorded }));

import { assertDatabaseTaskNode, databaseSwarmNodeId } from "./placement";

const nodeId = "a".repeat(25);
const other = "b".repeat(25);
beforeEach(() => {
	vi.resetAllMocks();
	mocks.getDocker.mockResolvedValue({ info: mocks.info, getNode: () => ({ inspect: mocks.node }) });
	mocks.info.mockResolvedValue({
		Swarm: { LocalNodeState: "active", NodeID: nodeId, ControlAvailable: true },
	});
	mocks.node.mockResolvedValue({ ID: nodeId, Status: { State: "ready" } });
	mocks.recorded.mockResolvedValue(nodeId);
});

describe("database daemon placement", () => {
	it("resolves the actual local manager instead of a manager role constraint", async () => {
		await expect(databaseSwarmNodeId(null)).resolves.toBe(nodeId);
		expect(mocks.recorded).not.toHaveBeenCalled();
	});
	it("verifies a remote daemon against its recorded node and primary Swarm", async () => {
		mocks.info.mockResolvedValue({
			Swarm: { LocalNodeState: "active", NodeID: nodeId, ControlAvailable: false },
		});
		await expect(databaseSwarmNodeId("server-id")).resolves.toBe(nodeId);
		expect(mocks.getDocker).toHaveBeenNthCalledWith(1, "server-id");
		expect(mocks.getDocker).toHaveBeenNthCalledWith(2);
	});
	it("rejects a rejoined remote daemon even when the former node remains ready", async () => {
		mocks.recorded.mockResolvedValue(other);
		await expect(databaseSwarmNodeId("server-id")).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
		});
		expect(mocks.node).not.toHaveBeenCalled();
	});
	it.each([
		{ LocalNodeState: "inactive", NodeID: nodeId, ControlAvailable: true },
		{ LocalNodeState: "active", NodeID: "", ControlAvailable: true },
		{ LocalNodeState: "active", NodeID: nodeId, ControlAvailable: false },
	])("rejects an unverified local daemon: %j", async (Swarm) => {
		mocks.info.mockResolvedValue({ Swarm });
		await expect(databaseSwarmNodeId(null)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
	it("rejects an absent or unavailable primary node", async () => {
		mocks.node.mockResolvedValue({ ID: nodeId, Status: { State: "down" } });
		await expect(databaseSwarmNodeId(null)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	});
});

describe("existing database data placement", () => {
	it("pins an existing unconstrained service only when its task history belongs to this node", () => {
		expect(() =>
			assertDatabaseTaskNode([{ NodeID: nodeId, Status: { State: "running" } }], nodeId),
		).not.toThrow();
	});
	it("rejects another manager's current or historical task before moving its local volume", () => {
		for (const state of ["running", "shutdown"]) {
			expect(() =>
				assertDatabaseTaskNode([{ NodeID: other, Status: { State: state } }], nodeId),
			).toThrow("another node");
		}
	});
	it("retains a stopped service's concrete pin even after task history expires", () => {
		expect(() => assertDatabaseTaskNode([], nodeId, [`node.id==${nodeId}`])).not.toThrow();
		expect(() => assertDatabaseTaskNode([], nodeId)).toThrow("cannot be verified");
		expect(() => assertDatabaseTaskNode([], nodeId, [`node.id==${other}`])).toThrow(
			"another storage node",
		);
	});
	it("does not treat unassigned pending tasks as evidence of an old unconstrained volume location", () => {
		const pending = [{ Status: { State: "pending" } }];
		expect(() => assertDatabaseTaskNode(pending, nodeId)).toThrow(
			"storage node cannot be verified",
		);
		expect(() => assertDatabaseTaskNode(pending, nodeId, [`node.id==${nodeId}`])).not.toThrow();
		expect(() =>
			assertDatabaseTaskNode([{ Status: { State: "running" } }], nodeId, [`node.id==${nodeId}`]),
		).toThrow("cannot be verified");
	});
	it.each(["orphaned", "unknown", ""])("fails closed for %s task placement", (state) => {
		expect(() =>
			assertDatabaseTaskNode([{ NodeID: nodeId, Status: { State: state } }], nodeId),
		).toThrow("cannot be verified");
	});
});
