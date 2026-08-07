import { describe, expect, it } from "vitest";
import { containerBelongsToApp } from "./containers";

describe("containerBelongsToApp", () => {
	it("matches compose project label", () => {
		expect(
			containerBelongsToApp({
				appName: "myapp",
				name: "/myapp-web-1",
				labels: { "com.docker.compose.project": "myapp" },
			}),
		).toBe(true);
	});

	it("matches stack namespace label", () => {
		expect(
			containerBelongsToApp({
				appName: "myapp",
				name: "/myapp_web.1.abc",
				labels: { "com.docker.stack.namespace": "myapp" },
			}),
		).toBe(true);
	});

	it("matches swarm service name prefix", () => {
		expect(
			containerBelongsToApp({
				appName: "myapp",
				labels: { "com.docker.swarm.service.name": "myapp_api" },
			}),
		).toBe(true);
	});

	it("matches name prefixes", () => {
		expect(containerBelongsToApp({ appName: "myapp", name: "myapp-db-1" })).toBe(true);
		expect(containerBelongsToApp({ appName: "myapp", name: "myapp_redis.1" })).toBe(true);
	});

	it("rejects unrelated containers", () => {
		expect(
			containerBelongsToApp({
				appName: "myapp",
				name: "other-web-1",
				labels: { "com.docker.compose.project": "other" },
			}),
		).toBe(false);
		expect(containerBelongsToApp({ appName: "myapp", name: "myapplication-1" })).toBe(false);
	});
});
