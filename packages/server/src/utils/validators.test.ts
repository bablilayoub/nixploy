import { describe, expect, it } from "vitest";
import {
	assertPullableImageRef,
	assertSafeDockerImageRef,
	assertSafePublishedPort,
	isPrivateRegistryHost,
} from "./validators";

describe("assertSafeDockerImageRef", () => {
	it("accepts ordinary references", () => {
		expect(assertSafeDockerImageRef("nginx:1.27")).toBe("nginx:1.27");
		expect(assertSafeDockerImageRef("ghcr.io/org/app@sha256:abc")).toBe(
			"ghcr.io/org/app@sha256:abc",
		);
	});

	it("rejects flags, traversal and whitespace", () => {
		expect(() => assertSafeDockerImageRef("--privileged")).toThrow(/Invalid Docker image/);
		expect(() => assertSafeDockerImageRef("a/../b")).toThrow(/Invalid Docker image/);
		expect(() => assertSafeDockerImageRef("nginx latest")).toThrow(/Invalid Docker image/);
	});
});

describe("isPrivateRegistryHost", () => {
	it("flags LAN, overlay and bare-label registries", () => {
		expect(isPrivateRegistryHost("10.0.1.5")).toBe(true);
		expect(isPrivateRegistryHost("192.168.1.5:5000")).toBe(true);
		expect(isPrivateRegistryHost("127.0.0.1:5000")).toBe(true);
		expect(isPrivateRegistryHost("localhost")).toBe(true);
		expect(isPrivateRegistryHost("registry")).toBe(true);
		expect(isPrivateRegistryHost("registry.internal")).toBe(true);
	});

	it("leaves public registries alone", () => {
		expect(isPrivateRegistryHost("docker.io")).toBe(false);
		expect(isPrivateRegistryHost("ghcr.io")).toBe(false);
		expect(isPrivateRegistryHost("registry.example.com:5000")).toBe(false);
		expect(isPrivateRegistryHost("cafe.ba")).toBe(false);
	});
});

describe("assertPullableImageRef", () => {
	it("passes public images through", () => {
		expect(assertPullableImageRef("nginx:1.27")).toBe("nginx:1.27");
		expect(assertPullableImageRef("ghcr.io/org/app:v1")).toBe("ghcr.io/org/app:v1");
	});

	it("refuses a private registry with no matching self-hosted row", () => {
		expect(() => assertPullableImageRef("10.0.1.5:5000/team/app")).toThrow(/private registry/);
		expect(() => assertPullableImageRef("registry:5000/team/app")).toThrow(/private registry/);
	});

	it("allows a private registry the organization actually configured", () => {
		expect(assertPullableImageRef("10.0.1.5:5000/team/app", ["https://10.0.1.5:5000"])).toBe(
			"10.0.1.5:5000/team/app",
		);
		expect(assertPullableImageRef("registry:5000/team/app", ["registry:5000"])).toBe(
			"registry:5000/team/app",
		);
	});
});

describe("assertSafePublishedPort", () => {
	it("blocks privileged and sensitive ports", () => {
		expect(() => assertSafePublishedPort(22)).toThrow();
		expect(() => assertSafePublishedPort(5432)).toThrow();
		expect(() => assertSafePublishedPort(80)).toThrow();
		expect(() => assertSafePublishedPort(8080)).not.toThrow();
	});
});
