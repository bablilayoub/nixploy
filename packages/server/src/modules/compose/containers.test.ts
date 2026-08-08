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

	it("matches exact swarm service name", () => {
		expect(
			containerBelongsToApp({
				appName: "myapp",
				labels: { "com.docker.swarm.service.name": "myapp" },
			}),
		).toBe(true);
	});

	it("matches swarm task names and exact names only", () => {
		expect(containerBelongsToApp({ appName: "myapp", name: "myapp" })).toBe(true);
		expect(containerBelongsToApp({ appName: "myapp", name: "myapp.1.taskid" })).toBe(true);
	});

	it("rejects prefix collisions across tenants", () => {
		expect(containerBelongsToApp({ appName: "api", name: "api-gateway" })).toBe(false);
		expect(
			containerBelongsToApp({
				appName: "api",
				labels: { "com.docker.swarm.service.name": "api_gateway" },
			}),
		).toBe(false);
		expect(containerBelongsToApp({ appName: "myapp", name: "myapplication-1" })).toBe(false);
		expect(
			containerBelongsToApp({
				appName: "myapp",
				name: "other-web-1",
				labels: { "com.docker.compose.project": "other" },
			}),
		).toBe(false);
	});
});
