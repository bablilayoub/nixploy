import { describe, expect, it } from "vitest";
import { buildPlan, diffFields, type LiveStackState, summarizePlanNeeds } from "./plan";
import type { NixployStack } from "./schema";

const liveState = (overrides: Partial<LiveStackState> = {}): LiveStackState => ({
	projectId: "p1",
	environmentName: "prod",
	applications: [],
	compose: [],
	databases: { postgres: [], mysql: [], mariadb: [], mongo: [], redis: [] },
	...overrides,
});

const stack = (overrides: Partial<NixployStack> = {}): NixployStack => ({
	version: 1,
	project: { name: "demo" },
	...overrides,
});

describe("buildPlan domain deletions", () => {
	it("emits a delete item for a live domain absent from the desired stack", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [
							{ host: "app.example.com", path: "/", https: false, certificateType: "none" },
						],
					},
				],
			}),
			liveState({
				applications: [
					{
						name: "web",
						appName: "web-a1b2c3",
						row: {},
						domains: [
							{
								host: "app.example.com",
								path: "/",
								port: null,
								https: false,
								certificateType: "none",
							},
							{ host: "old.example.com", path: "/", port: null, https: false },
						],
					},
				],
			}),
		);

		const domainItems = plan.items.filter((item) => item.kind === "domain");
		expect(domainItems).toHaveLength(2);
		expect(domainItems.find((item) => item.name === "app.example.com")?.action).toBe("noop");
		const removed = domainItems.find((item) => item.name === "old.example.com");
		expect(removed?.action).toBe("delete");
		expect(removed?.parent).toBe("web");
		expect(plan.summary.delete).toBe(1);
	});

	it("deletes every live domain when the desired app declares an empty list", () => {
		const plan = buildPlan(
			stack({
				applications: [{ name: "web", environment: "prod", domains: [] }],
			}),
			liveState({
				applications: [
					{
						name: "web",
						appName: "web-a1b2c3",
						row: {},
						domains: [{ host: "app.example.com", path: "/", port: 3000, https: true }],
					},
				],
			}),
		);

		const domainItems = plan.items.filter((item) => item.kind === "domain");
		expect(domainItems).toHaveLength(1);
		expect(domainItems[0]?.action).toBe("delete");
		expect(plan.summary.delete).toBe(1);
	});

	it("emits no delete items when live and desired domains match", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [{ host: "app.example.com", path: "/", https: true }],
					},
				],
			}),
			liveState({
				applications: [
					{
						name: "web",
						appName: "web-a1b2c3",
						row: {},
						domains: [
							{
								host: "app.example.com",
								path: "/",
								port: null,
								https: true,
								certificateType: "none",
							},
						],
					},
				],
			}),
		);

		expect(plan.items.filter((item) => item.action === "delete")).toHaveLength(0);
		expect(plan.summary.delete).toBe(0);
	});
});

describe("diffFields", () => {
	it("only diffs keys the manifest defines (undefined means keep)", () => {
		const live = { buildType: "nixpacks", replicas: 1, branch: "main", autoDeploy: true };
		expect(diffFields({ branch: "main" }, live, ["buildType", "replicas", "branch"])).toEqual([]);
		expect(diffFields({ branch: "dev" }, live, ["buildType", "replicas", "branch"])).toEqual([
			"branch",
		]);
		expect(diffFields({ replicas: undefined }, live, ["replicas"])).toEqual([]);
		// explicit null is a real value: clear the column
		expect(diffFields({ branch: null }, live, ["branch"])).toEqual(["branch"]);
	});
});

describe("buildPlan hand-written manifests", () => {
	it("reports noop for an app whose manifest omits every defaulted field", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{ name: "web", environment: "prod", repository: "repo", owner: "me", branch: "main" },
				],
			}),
			liveState({
				applications: [
					{
						name: "web",
						appName: "web-a1b2c3",
						row: {
							buildType: "nixpacks",
							sourceType: "github",
							repository: "repo",
							owner: "me",
							branch: "main",
							buildPath: "/",
							replicas: 1,
							autoDeploy: true,
							description: null,
						},
						domains: [],
					},
				],
			}),
		);
		expect(plan.items).toEqual([
			{ kind: "application", action: "noop", name: "web", environment: "prod", changes: undefined },
		]);
		expect(summarizePlanNeeds(plan)).toEqual({ creates: 0, writes: false, redeploys: 0 });
	});

	it("keeps a live letsencrypt domain when the manifest only lists the host", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{
						name: "web",
						environment: "prod",
						domains: [{ host: "app.example.com", path: undefined }],
					},
				],
			}),
			liveState({
				applications: [
					{
						name: "web",
						appName: "web-a1b2c3",
						row: {},
						domains: [
							{
								host: "app.example.com",
								path: "/",
								port: null,
								https: true,
								certificateType: "letsencrypt",
								serviceName: null,
							},
						],
					},
				],
			}),
		);
		const domain = plan.items.find((item) => item.kind === "domain");
		expect(domain?.action).toBe("noop");
	});

	it("ignores serviceName on application domains but diffs it on compose domains", () => {
		const desiredDomain = { host: "app.example.com", path: undefined, serviceName: "web" };
		const liveDomain = {
			host: "app.example.com",
			path: "/",
			port: null,
			https: false,
			certificateType: "none",
			serviceName: null,
		};
		const plan = buildPlan(
			stack({
				applications: [{ name: "app", environment: "prod", domains: [desiredDomain] }],
				compose: [{ name: "stack", environment: "prod", domains: [desiredDomain] }],
			}),
			liveState({
				applications: [{ name: "app", appName: "app-1", row: {}, domains: [liveDomain] }],
				compose: [{ name: "stack", appName: "stack-1", row: {}, domains: [liveDomain] }],
			}),
		);
		const domains = plan.items.filter((item) => item.kind === "domain");
		expect(domains.find((item) => item.parent === "app")?.action).toBe("noop");
		expect(domains.find((item) => item.parent === "stack")?.action).toBe("update");
		expect(domains.find((item) => item.parent === "stack")?.changes).toEqual(["serviceName"]);
	});
});

describe("summarizePlanNeeds", () => {
	it("counts creates, flags writes and counts redeployable services", () => {
		const plan = buildPlan(
			stack({
				applications: [
					{ name: "new", environment: "prod" },
					{ name: "changed", environment: "prod", branch: "dev" },
					{ name: "same", environment: "prod", branch: "main" },
				],
				databases: { redis: [{ name: "cache", environment: "prod" }] },
			}),
			liveState({
				applications: [
					{ name: "changed", appName: "c-1", row: { branch: "main" }, domains: [] },
					{ name: "same", appName: "s-1", row: { branch: "main" }, domains: [] },
				],
			}),
		);
		expect(summarizePlanNeeds(plan)).toEqual({ creates: 2, writes: true, redeploys: 2 });
	});
});
