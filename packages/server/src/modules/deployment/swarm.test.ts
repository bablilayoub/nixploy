import { describe, expect, it } from "vitest";
import { environmentNetworkName } from "./network";
import {
	buildContainerSpec,
	buildRuntimeSpecs,
	buildTaskResources,
	DEFAULT_CAPABILITY_ADD,
	DEFAULT_PIDS_LIMIT,
	sanitizeNetworkAttachments,
	withNodeConstraint,
} from "./swarm";

describe("withNodeConstraint", () => {
	it("leaves the user's placement untouched for unpinned services", () => {
		expect(withNodeConstraint(null, null)).toBeUndefined();
		expect(withNodeConstraint({ Constraints: ["node.role==worker"] }, null)).toEqual({
			Constraints: ["node.role==worker"],
		});
	});

	it("adds node.id== for pinned services, keeping other constraints and preferences", () => {
		expect(
			withNodeConstraint(
				{
					Constraints: ["node.role==worker", "node.labels.zone==eu"],
					Preferences: [{ Spread: { SpreadDescriptor: "node.labels.zone" } }],
				},
				"nodeabc",
			),
		).toEqual({
			Constraints: ["node.role==worker", "node.labels.zone==eu", "node.id==nodeabc"],
			Preferences: [{ Spread: { SpreadDescriptor: "node.labels.zone" } }],
		});
		expect(withNodeConstraint(undefined, "nodeabc")).toEqual({
			Constraints: ["node.id==nodeabc"],
		});
	});

	it("never duplicates the pin and replaces a foreign node.id== pin", () => {
		// A stale/foreign node pin next to ours would leave the task unschedulable.
		expect(
			withNodeConstraint(
				{ Constraints: ["node.id==nodeabc", "node.id == other", "node.id!=old"] },
				"nodeabc",
			),
		).toEqual({ Constraints: ["node.id!=old", "node.id==nodeabc"] });
	});
});

describe("buildRuntimeSpecs", () => {
	const mounts = [
		{
			type: "volume" as const,
			volumeName: "app-data",
			filePath: null,
			hostPath: null,
			mountPath: "/data",
		},
		{
			type: "file" as const,
			volumeName: null,
			filePath: "config.json",
			hostPath: null,
			mountPath: "/app/config.json",
		},
	];
	const ports = [
		{
			protocol: "tcp" as const,
			publishedPort: 8080,
			targetPort: 80,
			publishMode: "ingress" as const,
		},
	];

	it("maps the application's mounts and published ports for production", () => {
		const specs = buildRuntimeSpecs("myapp", mounts, ports);
		expect(specs.ports).toEqual([
			{ Protocol: "tcp", PublishedPort: 8080, TargetPort: 80, PublishMode: "ingress" },
		]);
		expect(specs.mounts.map((m) => m.Type)).toEqual(["volume", "bind"]);
		expect(specs.mounts[0]).toMatchObject({ Source: "app-data", Target: "/data" });
	});

	it("strips ports, volumes and file mounts for PR previews", () => {
		// A published port collides with production on the ingress network, a
		// volume would let the PR build write into production data, and file
		// mounts were never materialized under the preview appName.
		expect(buildRuntimeSpecs("myapp-pr-7", mounts, ports, { preview: true })).toEqual({
			mounts: [],
			ports: [],
		});
	});
});

describe("buildContainerSpec", () => {
	it("keeps explicit empties through JSON serialization so updates clear old values", () => {
		const spec = buildContainerSpec({
			imageTag: "registry.example.com/app:latest",
			env: [],
			mounts: [],
			command: null,
			healthCheck: null,
		});
		// dockerode serializes the spec to JSON; `undefined` keys would vanish
		// and the engine would keep the previous env/command/healthcheck.
		const wire = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
		expect(wire.Image).toBe("registry.example.com/app:latest");
		expect(wire.Env).toEqual([]);
		expect(wire.Mounts).toEqual([]);
		expect(wire.Command).toBeNull();
		expect(wire.HealthCheck).toBeNull();
	});

	it("sets env, command and healthcheck when provided", () => {
		const spec = buildContainerSpec({
			imageTag: "app:latest",
			env: ["A=1", "B=2"],
			mounts: [{ Type: "volume", Source: "data", Target: "/data" }],
			command: "npm start",
			healthCheck: { Test: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"] },
		});
		const wire = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
		expect(wire.Env).toEqual(["A=1", "B=2"]);
		expect(wire.Command).toEqual(["/bin/sh", "-c", "npm start"]);
		expect(wire.HealthCheck).toEqual({
			Test: ["CMD-SHELL", "curl -f http://localhost/ || exit 1"],
		});
		expect(wire.Mounts).toEqual([{ Type: "volume", Source: "data", Target: "/data" }]);
	});
});

describe("buildContainerSpec hardening", () => {
	const wire = () =>
		JSON.parse(
			JSON.stringify(
				buildContainerSpec({
					imageTag: "app:latest",
					env: [],
					mounts: [],
					command: null,
					healthCheck: null,
				}),
			),
		) as Record<string, unknown>;

	it("drops every capability and adds back only the minimal start-up set", () => {
		const spec = wire();
		expect(spec.CapabilityDrop).toEqual(["ALL"]);
		expect(spec.CapabilityAdd).toEqual([
			"CHOWN",
			"DAC_OVERRIDE",
			"FOWNER",
			"KILL",
			"NET_BIND_SERVICE",
			"SETGID",
			"SETUID",
		]);
		// NET_RAW (ARP/DNS spoofing on a shared L2) and SYS_* stay dropped.
		expect(DEFAULT_CAPABILITY_ADD).not.toContain("NET_RAW");
		expect(DEFAULT_CAPABILITY_ADD).not.toContain("MKNOD");
	});

	it("writes no-new-privileges and a file-descriptor ceiling explicitly", () => {
		const spec = wire();
		// Explicit (not undefined) so a live spec that grew Privileges out of
		// band is reset by the merge in upsertSwarmService.
		expect(spec.Privileges).toEqual({ NoNewPrivileges: true });
		expect(spec.Ulimits).toEqual([{ Name: "nofile", Soft: 65536, Hard: 65536 }]);
	});
});

describe("buildTaskResources", () => {
	it("always caps Pids and keeps the service's own limits", () => {
		expect(buildTaskResources({ MemoryBytes: 512, NanoCPUs: 5e8 }, {})).toEqual({
			Limits: { MemoryBytes: 512, NanoCPUs: 5e8, Pids: DEFAULT_PIDS_LIMIT },
			Reservations: undefined,
		});
	});

	it("fills missing limits from the org quota but never overrides explicit ones", () => {
		expect(
			buildTaskResources({ MemoryBytes: 512 }, {}, { memoryBytes: 999, nanoCpus: 2e9 }),
		).toEqual({
			Limits: { MemoryBytes: 512, NanoCPUs: 2e9, Pids: DEFAULT_PIDS_LIMIT },
			Reservations: undefined,
		});
	});

	it("keeps reservations only when the service set some", () => {
		expect(buildTaskResources({}, { MemoryBytes: 128 }).Reservations).toEqual({
			MemoryBytes: 128,
		});
		expect(buildTaskResources({}, {}).Reservations).toBeUndefined();
	});
});

describe("sanitizeNetworkAttachments", () => {
	const envNet = "production-abc12345-net";

	it("attaches only the environment overlay when the service has no domain", () => {
		expect(sanitizeNetworkAttachments(null, { environmentNetwork: envNet, shared: false })).toEqual(
			[{ Target: envNet }],
		);
	});

	it("adds the shared overlay for routed services so Traefik can reach them", () => {
		expect(sanitizeNetworkAttachments(null, { environmentNetwork: envNet, shared: true })).toEqual([
			{ Target: envNet },
			{ Target: "nixploy-network" },
		]);
	});

	it("never lets an override re-add the shared overlay for an unrouted service", () => {
		// Otherwise a service with no domain could put itself next to the panel.
		expect(
			sanitizeNetworkAttachments([{ Target: "nixploy-network" }], {
				environmentNetwork: envNet,
				shared: false,
			}),
		).toEqual([{ Target: envNet }]);
	});

	it("never attaches the panel overlay, even when an admin asks for it", () => {
		// nixploy-internal carries the panel and the platform Postgres.
		expect(
			sanitizeNetworkAttachments([{ Target: "nixploy-internal" }], {
				environmentNetwork: envNet,
				shared: true,
			}),
		).toEqual([{ Target: envNet }, { Target: "nixploy-network" }]);
	});

	it("keeps admin-listed platform overlays and drops everything else", () => {
		expect(
			sanitizeNetworkAttachments(
				[
					{ Target: "nixploy-extra", Aliases: ["api"] },
					{ Target: "ingress" },
					{ Target: "other-tenant-env-net" },
					"nope",
				],
				{ environmentNetwork: envNet, shared: false },
			),
		).toEqual([{ Target: envNet }, { Target: "nixploy-extra", Aliases: ["api"] }]);
	});
});

describe("environmentNetworkName", () => {
	it("derives a readable, unique, non-platform name", () => {
		expect(
			environmentNetworkName({
				environmentId: "da5e4350-1111-2222-3333-444455556666",
				name: "production",
			}),
		).toBe("production-da5e4350-net");
		expect(environmentNetworkName({ environmentId: "abcdefgh", name: "Staging EU!" })).toBe(
			"staging-eu-abcdefgh-net",
		);
	});

	it("never lands in the platform namespace", () => {
		// `nixploy-*` is admin-only in sanitizeNetworkAttachments — a tenant must
		// not be able to name an environment into it.
		expect(
			environmentNetworkName({ environmentId: "deadbeef", name: "nixploy" }).startsWith("nixploy-"),
		).toBe(false);
	});
});

describe("resolveContainerPrivileges", () => {
	it("keeps the baseline when no override is set", async () => {
		const { resolveContainerPrivileges, DEFAULT_CAPABILITY_ADD } = await import("./swarm");
		const result = resolveContainerPrivileges(null);
		expect(result.CapabilityAdd).toEqual([...DEFAULT_CAPABILITY_ADD]);
		expect(result.CapabilityDrop).toEqual(["ALL"]);
		expect(result.Privileges).toEqual({ NoNewPrivileges: true });
	});

	it("merges an instance-admin override over the baseline", async () => {
		const { resolveContainerPrivileges } = await import("./swarm");
		const result = resolveContainerPrivileges({
			capabilityAdd: ["NET_RAW", "CHOWN"],
			securityOpt: ["no-new-privileges:false", "seccomp=unconfined"],
		});
		expect(result.CapabilityAdd).toContain("NET_RAW");
		expect(result.CapabilityAdd.filter((cap) => cap === "CHOWN")).toHaveLength(1);
		expect(result.CapabilityDrop).toEqual(["ALL"]);
		expect(result.Privileges).toEqual({
			NoNewPrivileges: false,
			Seccomp: { Mode: "unconfined" },
		});
	});
});

describe("assessConvergence", () => {
	it("reports running as soon as one task runs", async () => {
		const { assessConvergence } = await import("./swarm");
		expect(
			assessConvergence([
				{ Status: { State: "failed" }, CreatedAt: "2026-01-01T00:00:00Z" },
				{ Status: { State: "running" }, CreatedAt: "2026-01-01T00:00:05Z" },
			]),
		).toEqual({ state: "running" });
	});

	it("fails after three consecutive failed tasks with the engine reason", async () => {
		const { assessConvergence } = await import("./swarm");
		expect(
			assessConvergence([
				{ Status: { State: "failed", Err: "exec: not found" }, CreatedAt: "2026-01-01T00:00:03Z" },
				{ Status: { State: "rejected", Err: "no such image" }, CreatedAt: "2026-01-01T00:00:02Z" },
				{ Status: { State: "failed", Err: "oom" }, CreatedAt: "2026-01-01T00:00:01Z" },
			]),
		).toEqual({ state: "failed", reason: "exec: not found" });
	});

	it("keeps waiting while tasks are preparing", async () => {
		const { assessConvergence } = await import("./swarm");
		expect(
			assessConvergence([{ Status: { State: "preparing" }, CreatedAt: "2026-01-01T00:00:00Z" }]),
		).toEqual({ state: "pending" });
	});
});
