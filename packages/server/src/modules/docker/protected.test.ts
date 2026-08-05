import { describe, expect, it } from "vitest";
import {
	isProtectedContainerNames,
	isProtectedPlatformName,
	PROTECTED_NETWORKS,
	PROTECTED_VOLUMES,
} from "./protected";

describe("isProtectedPlatformName", () => {
	it("matches exact platform service names", () => {
		expect(isProtectedPlatformName("nixploy")).toBe(true);
		expect(isProtectedPlatformName("nixploy-postgres")).toBe(true);
		expect(isProtectedPlatformName("nixploy-traefik")).toBe(true);
	});

	it("matches Swarm task names for those services", () => {
		expect(
			isProtectedPlatformName(
				"nixploy-traefik.753pwxuumihrlswd6y5rgu28n.8gvb48q0py41d3h0xg1of031w",
			),
		).toBe(true);
		expect(isProtectedPlatformName("nixploy.abc.def")).toBe(true);
		expect(isProtectedPlatformName("nixploy-postgres.1.xyz")).toBe(true);
	});

	it("strips a leading slash from docker inspect names", () => {
		expect(isProtectedPlatformName("/nixploy-postgres")).toBe(true);
	});

	it("does not match user apps that merely start with nixploy-", () => {
		expect(isProtectedPlatformName("nixploy-my-app")).toBe(false);
		expect(isProtectedPlatformName("nixploy-postgres-backup")).toBe(false);
		expect(isProtectedPlatformName("my-nixploy")).toBe(false);
	});
});

describe("isProtectedContainerNames", () => {
	it("treats any matching alias as protected", () => {
		expect(isProtectedContainerNames("nixploy-postgres")).toBe(true);
		expect(isProtectedContainerNames("foo,nixploy-traefik,bar")).toBe(true);
		expect(isProtectedContainerNames("user-app")).toBe(false);
	});
});

describe("protected sets", () => {
	it("includes the Nixploy overlay network and Postgres volume", () => {
		expect(PROTECTED_NETWORKS.has("nixploy-network")).toBe(true);
		expect(PROTECTED_VOLUMES.has("nixploy-postgres-data")).toBe(true);
	});
});
