import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("../deployment", () => ({ queueDeployment: vi.fn() }));
vi.mock("../application/paths", () => ({
	getWildcardDomain: () => "example.test",
}));
vi.mock("../application/docker", () => ({
	removeSwarmService: vi.fn(),
}));
vi.mock("../traefik", () => ({
	writeAppTraefikConfig: vi.fn(),
	removeTraefikConfig: vi.fn(),
}));

import { classifyPullRequestAction, previewAppName, previewHost } from "./index";

describe("previewAppName / previewHost", () => {
	it("uses the Dokploy-style variant naming", () => {
		expect(previewAppName("echo-4a4487", "12")).toBe("echo-4a4487-pr-12");
		expect(previewHost("echo-4a4487", "12")).toBe("pr-12-echo-4a4487.example.test");
	});
});

describe("classifyPullRequestAction", () => {
	it("maps provider actions to upsert or delete", () => {
		expect(classifyPullRequestAction("opened")).toBe("upsert");
		expect(classifyPullRequestAction("synchronize")).toBe("upsert");
		expect(classifyPullRequestAction("closed")).toBe("delete");
		expect(classifyPullRequestAction("fulfilled")).toBe("delete");
		expect(classifyPullRequestAction("ready_for_review")).toBe("ignore");
	});
});
