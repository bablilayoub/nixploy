import { describe, expect, it } from "vitest";
import { buildContainerSpec, buildRuntimeSpecs, withNodeConstraint } from "./swarm";

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
