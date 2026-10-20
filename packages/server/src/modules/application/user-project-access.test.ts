import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	application: vi.fn(),
	membership: vi.fn(),
	filter: vi.fn(),
}));
vi.mock("../../db", () => ({
	db: {
		query: {
			applications: { findFirst: mocks.application },
			members: { findFirst: mocks.membership },
		},
	},
}));
vi.mock("../projects", () => ({
	resolveCallerOrganizationId: vi.fn(),
	assertProjectVisible: vi.fn(),
	resolveProjectFilter: mocks.filter,
}));
vi.mock("../services/registry", () => ({ SERVICE_REGISTRY: {} }));

import { findApplicationByAppNameForUser, findApplicationForUser } from "./org";

const application = {
	applicationId: "app-1",
	appName: "owned-app",
	environment: { projectId: "project-1", project: { organizationId: "org-1" } },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.application.mockResolvedValue(application);
	mocks.membership.mockResolvedValue({ userId: "member-1", organizationId: "org-1" });
	mocks.filter.mockResolvedValue({ kind: "projects", projectIds: new Set(["project-1"]) });
});

describe.each([
	["source upload", () => findApplicationForUser("app-1", "member-1")],
	["deploy webhook", () => findApplicationByAppNameForUser("owned-app", "member-1")],
])("%s project authorization", (_label, lookup) => {
	it("returns a visible application", async () => {
		expect(await lookup()).toEqual(application);
		expect(mocks.filter).toHaveBeenCalledWith("member-1");
	});
	it("hides a same-org application outside the caller's teams", async () => {
		mocks.filter.mockResolvedValue({ kind: "projects", projectIds: new Set(["other-project"]) });
		expect(await lookup()).toBeNull();
	});
	it("resolves visibility again after team access is revoked", async () => {
		expect(await lookup()).toEqual(application);
		mocks.filter.mockResolvedValue({ kind: "projects", projectIds: new Set() });
		expect(await lookup()).toBeNull();
		expect(mocks.filter).toHaveBeenCalledTimes(2);
	});
	it("preserves unrestricted organization access", async () => {
		mocks.filter.mockResolvedValue({ kind: "all" });
		expect(await lookup()).toEqual(application);
	});
	it("fails closed when project resolution fails", async () => {
		mocks.filter.mockRejectedValue(new Error("Visibility lookup unavailable"));
		await expect(lookup()).rejects.toThrow("Visibility lookup unavailable");
	});
	it("still requires organization membership", async () => {
		mocks.membership.mockResolvedValue(undefined);
		expect(await lookup()).toBeNull();
		expect(mocks.filter).not.toHaveBeenCalled();
	});
});
