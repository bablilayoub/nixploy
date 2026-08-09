import { describe, expect, it } from "vitest";
import { buildContainerSpec } from "./swarm";

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
