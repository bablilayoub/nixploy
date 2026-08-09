import { describe, expect, it } from "vitest";
import { buildPlan, type LiveStackState } from "./plan";
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

	it("deletes every live domain when the desired app declares none", () => {
		const plan = buildPlan(
			stack({
				applications: [{ name: "web", environment: "prod" }],
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
