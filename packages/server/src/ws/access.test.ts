import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeWsSession } from "../test-utils/fake-session";

/**
 * The websocket gates are the only authorization in front of live logs,
 * container stats, and interactive shells — tRPC's `protectedProcedure` never
 * runs for `/ws/*`. They had no tests at all (audit F8 / ops-dx #19).
 *
 * Every path is exercised here: the caller's own service, another tenant's
 * service, the instance-admin fallback for unlabelled / foreign containers,
 * the capability gates, and the org-level 2FA gate.
 */

const state = vi.hoisted(() => ({
	/** appName → organization that owns it (missing = no such service). */
	services: new Map<string, string>(),
	/** serverId → organization that owns it. */
	servers: new Map<string, string>(),
	/** containerId → appName resolved from Swarm/compose labels. */
	containerApps: new Map<string, string | null>(),
	/** deploymentId → owning organization, via application or compose. */
	deployments: new Map<string, { organizationId: string; via: "application" | "compose" }>(),
	capabilities: new Set<string>(),
	twoFactorBlocked: false,
}));

const TENANCY = (organizationId: string) => ({
	environment: { project: { organizationId } },
});

vi.mock("../db", async () => {
	const { createFakeDb, whereValues } = await import("../test-utils/fake-db");
	// Every service table answers from the same map: app names are globally
	// unique, so "the first table that matches wins" stays faithful. The gate
	// only ever looks a row up by one literal (`eq(<table>.appName, name)`).
	const serviceTable = () => ({
		findFirst: (args: unknown) => {
			const appName = whereValues(args)[0] as string | undefined;
			const organizationId = appName ? state.services.get(appName) : undefined;
			return organizationId ? TENANCY(organizationId) : undefined;
		},
	});
	const { db } = createFakeDb({
		query: {
			applications: serviceTable(),
			compose: serviceTable(),
			postgres: serviceTable(),
			mysql: serviceTable(),
			mariadb: serviceTable(),
			mongo: serviceTable(),
			redis: serviceTable(),
			deployments: {
				findFirst: (args: unknown) => {
					const deploymentId = whereValues(args)[0] as string | undefined;
					const found = deploymentId ? state.deployments.get(deploymentId) : undefined;
					if (!found || !deploymentId) return undefined;
					return {
						deploymentId,
						[found.via]: TENANCY(found.organizationId),
					};
				},
			},
		},
	});
	return { db };
});

vi.mock("../modules/auth/two-factor-gate", () => ({
	isTwoFactorGateBlocked: async () => state.twoFactorBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE: "Two-factor authentication is required",
}));

vi.mock("../modules/cluster/servers", () => ({
	findServerById: async (serverId: string, organizationId: string) =>
		state.servers.get(serverId) === organizationId ? { serverId } : null,
}));

vi.mock("../modules/projects", () => ({
	resolveCallerOrganizationId: async () => "org-a",
	hasCapability: async (_userId: string, _orgId: string, capability: string) =>
		state.capabilities.has(capability),
}));

vi.mock("./docker", () => ({
	resolveContainerAppName: async (containerId: string) =>
		state.containerApps.get(containerId) ?? null,
}));

import {
	assertWsContainerAccess,
	assertWsDeploymentAccess,
	assertWsDockerContainerAccess,
	assertWsTerminalAccess,
	resolveWsOrganizationId,
} from "./access";

const member = fakeWsSession({ userId: "u-member", role: "user" });
const admin = fakeWsSession({ userId: "u-admin", instanceAdmin: true });

beforeEach(() => {
	state.services = new Map([
		["mine", "org-a"],
		["theirs", "org-b"],
	]);
	state.servers = new Map([
		["srv-mine", "org-a"],
		["srv-theirs", "org-b"],
	]);
	state.containerApps = new Map();
	state.deployments = new Map();
	state.capabilities = new Set();
	state.twoFactorBlocked = false;
});

describe("resolveWsOrganizationId", () => {
	it("resolves the caller's org like protectedProcedure does", async () => {
		await expect(resolveWsOrganizationId(member)).resolves.toBe("org-a");
	});

	it("refuses every stream while the org 2FA gate blocks the user", async () => {
		state.twoFactorBlocked = true;
		await expect(resolveWsOrganizationId(member)).rejects.toThrow(
			"Two-factor authentication is required",
		);
	});
});

describe("assertWsContainerAccess", () => {
	it("allows a service of the caller's own organization", async () => {
		await expect(assertWsContainerAccess(member, "mine", null)).resolves.toBeUndefined();
	});

	it("refuses another organization's service with the same error as a miss", async () => {
		await expect(assertWsContainerAccess(member, "theirs", null)).rejects.toThrow(
			"Service not found: theirs",
		);

		await expect(assertWsContainerAccess(member, "nope", null)).rejects.toThrow(
			"Service not found: nope",
		);
	});

	it("refuses a server the caller's organization does not own", async () => {
		await expect(assertWsContainerAccess(member, "mine", "srv-mine")).resolves.toBeUndefined();
		await expect(assertWsContainerAccess(member, "mine", "srv-theirs")).rejects.toThrow(
			"Server not found: srv-theirs",
		);
	});

	it("applies the 2FA gate before any lookup", async () => {
		state.twoFactorBlocked = true;
		await expect(assertWsContainerAccess(member, "mine", null)).rejects.toThrow(
			"Two-factor authentication is required",
		);
	});
});

describe("assertWsTerminalAccess", () => {
	it('requires the "service.runtime" capability', async () => {
		await expect(assertWsTerminalAccess(member, "mine", null)).rejects.toThrow(
			'This action requires the "service.runtime" capability',
		);

		state.capabilities.add("service.runtime");
		await expect(assertWsTerminalAccess(member, "mine", null)).resolves.toBeUndefined();
	});

	it("still org-scopes the service after the capability passes", async () => {
		state.capabilities.add("service.runtime");
		await expect(assertWsTerminalAccess(member, "theirs", null)).rejects.toThrow(
			"Service not found: theirs",
		);
	});
});

describe("assertWsDockerContainerAccess", () => {
	it('requires the "docker.manage" capability', async () => {
		await expect(assertWsDockerContainerAccess(member, "c1", null)).rejects.toThrow(
			'This action requires the "docker.manage" capability',
		);
	});

	it("restricts the local daemon to instance admins (it sees every org)", async () => {
		state.capabilities.add("docker.manage");
		await expect(assertWsDockerContainerAccess(member, "c1", null)).rejects.toThrow(
			"instance admin role",
		);
		await expect(assertWsDockerContainerAccess(admin, "c1", null)).resolves.toBeUndefined();
	});

	it("allows a remote container whose labels resolve to the caller's own service", async () => {
		state.capabilities.add("docker.manage");
		state.containerApps.set("c-mine", "mine");
		await expect(
			assertWsDockerContainerAccess(member, "c-mine", "srv-mine"),
		).resolves.toBeUndefined();
	});

	it("falls back to the instance-admin check for another tenant's container", async () => {
		state.capabilities.add("docker.manage");
		state.containerApps.set("c-theirs", "theirs");
		await expect(assertWsDockerContainerAccess(member, "c-theirs", "srv-mine")).rejects.toThrow(
			"instance admin role",
		);
		await expect(
			assertWsDockerContainerAccess(admin, "c-theirs", "srv-mine"),
		).resolves.toBeUndefined();
	});

	it("falls back to the instance-admin check for an unlabelled container", async () => {
		state.capabilities.add("docker.manage");
		state.containerApps.set("c-bare", null);
		await expect(assertWsDockerContainerAccess(member, "c-bare", "srv-mine")).rejects.toThrow(
			"instance admin role",
		);
		await expect(
			assertWsDockerContainerAccess(admin, "c-bare", "srv-mine"),
		).resolves.toBeUndefined();
	});

	it("checks the server before it ever inspects the container", async () => {
		state.capabilities.add("docker.manage");
		await expect(assertWsDockerContainerAccess(admin, "c1", "srv-theirs")).rejects.toThrow(
			"Server not found: srv-theirs",
		);
	});
});

describe("assertWsDeploymentAccess", () => {
	it("returns deployments of the caller's org, via application or compose", async () => {
		state.deployments.set("dep-app", { organizationId: "org-a", via: "application" });
		await expect(assertWsDeploymentAccess("dep-app", "org-a")).resolves.toMatchObject({
			deploymentId: "dep-app",
		});

		state.deployments.set("dep-compose", { organizationId: "org-a", via: "compose" });
		await expect(assertWsDeploymentAccess("dep-compose", "org-a")).resolves.toMatchObject({
			deploymentId: "dep-compose",
		});
	});

	it("refuses another organization's deployment and a missing one alike", async () => {
		state.deployments.set("dep-theirs", { organizationId: "org-b", via: "application" });
		await expect(assertWsDeploymentAccess("dep-theirs", "org-a")).rejects.toThrow(
			"Deployment not found: dep-theirs",
		);

		await expect(assertWsDeploymentAccess("dep-missing", "org-a")).rejects.toThrow(
			"Deployment not found: dep-missing",
		);
	});
});
