import { describe, expect, it } from "vitest";
import {
	isNodeIdConstraint,
	matchSwarmNode,
	mergeNodeConstraint,
	nodeIdConstraint,
} from "./placement";

describe("mergeNodeConstraint", () => {
	it("appends the pin once, after the user's constraints", () => {
		expect(mergeNodeConstraint(["node.role==worker", " node.labels.a==1 "], "n1")).toEqual([
			"node.role==worker",
			"node.labels.a==1",
			"node.id==n1",
		]);
		expect(mergeNodeConstraint(undefined, "n1")).toEqual(["node.id==n1"]);
	});

	it("drops duplicates, blanks and non-strings, and replaces other node.id== pins", () => {
		expect(
			mergeNodeConstraint(
				["node.id==n1", "node.id == n2", "", 42, "node.role==worker", "node.role==worker"],
				"n1",
			),
		).toEqual(["node.role==worker", "node.id==n1"]);
	});

	it("keeps a user node.id== pin when the service is not pinned to a server", () => {
		expect(mergeNodeConstraint(["node.id==theirs", "node.id==theirs"], null)).toEqual([
			"node.id==theirs",
		]);
	});

	it("recognizes node.id== but not node.id!=", () => {
		expect(isNodeIdConstraint(nodeIdConstraint("n1"))).toBe(true);
		expect(isNodeIdConstraint("node.id!=n1")).toBe(false);
		expect(isNodeIdConstraint("node.labels.id==n1")).toBe(false);
	});
});

describe("matchSwarmNode", () => {
	const nodes = [
		{ id: "aaa", hostname: "primary", addr: "10.0.0.1" },
		{ id: "bbb", hostname: "Worker-1.example.test", addr: "10.0.0.2" },
	];

	it("matches by advertised address first, then by hostname (case-insensitive)", () => {
		expect(matchSwarmNode(nodes, "10.0.0.2")).toBe("bbb");
		expect(matchSwarmNode(nodes, "worker-1.example.test")).toBe("bbb");
	});

	it("returns null for unknown or empty addresses", () => {
		expect(matchSwarmNode(nodes, "10.0.0.9")).toBeNull();
		expect(matchSwarmNode(nodes, "  ")).toBeNull();
		expect(matchSwarmNode([], "10.0.0.1")).toBeNull();
	});
});
