import { describe, expect, it } from "vitest";
import {
	buildDatabaseSwarmSpec,
	DATABASE_CONFIGS,
	isManagedDatabaseLabels,
	postgresMajorVersion,
	postgresPgdata,
	type ServiceDefinition,
	type ServiceState,
	statusFromServiceState,
	summarizeTaskStates,
} from "./engine";

describe("buildDatabaseSwarmSpec placement", () => {
	const def: ServiceDefinition = {
		name: "pg-abc123",
		image: "postgres:17",
		env: ["POSTGRES_DB=app"],
		args: [],
		volumeName: "pg-abc123-data",
		dataDir: "/var/lib/postgresql/data",
		publishedPort: null,
		targetPort: 5432,
		kind: "postgres",
	};
	const taskTemplate = (spec: Record<string, unknown>) =>
		spec.TaskTemplate as { Placement?: { Constraints?: string[] } };

	it("has no placement for databases on the Nixploy host", () => {
		expect(taskTemplate(buildDatabaseSwarmSpec(def, 1))).not.toHaveProperty("Placement");
		expect(taskTemplate(buildDatabaseSwarmSpec(def, 1, null))).not.toHaveProperty("Placement");
	});

	it("pins databases on a managed server to its swarm node (local data volume)", () => {
		const spec = buildDatabaseSwarmSpec(def, 1, "node123");
		expect(taskTemplate(spec).Placement).toEqual({ Constraints: ["node.id==node123"] });
		// The rest of the spec is unchanged by the pin.
		expect(spec.Mode).toEqual({ Replicated: { Replicas: 1 } });
		expect(spec.Labels).toEqual({ "nixploy.managed": "true", "nixploy.service.type": "postgres" });
	});
});

const state = (partial: Partial<ServiceState>): ServiceState => ({
	exists: true,
	desired: 1,
	running: 0,
	pending: 0,
	failed: 0,
	...partial,
});

describe("summarizeTaskStates", () => {
	it("counts running, pending and failed tasks", () => {
		expect(summarizeTaskStates(["running", "starting", "pending", "failed", "rejected"])).toEqual({
			running: 1,
			pending: 2,
			failed: 2,
		});
	});

	it("ignores normal lifecycle states (shutdown/complete)", () => {
		expect(summarizeTaskStates(["shutdown", "complete", "running"])).toEqual({
			running: 1,
			pending: 0,
			failed: 0,
		});
	});

	it("handles unknown states by ignoring them", () => {
		expect(summarizeTaskStates(["", "orphaned"])).toEqual({
			running: 0,
			pending: 0,
			failed: 0,
		});
	});
});

describe("statusFromServiceState", () => {
	it("is idle when the service does not exist", () => {
		expect(statusFromServiceState(state({ exists: false }))).toBe("idle");
	});

	it("is idle when scaled to zero", () => {
		expect(statusFromServiceState(state({ desired: 0 }))).toBe("idle");
	});

	it("is running when at least one task is up", () => {
		expect(statusFromServiceState(state({ running: 1 }))).toBe("running");
		// Old task failures don't matter once the service recovered.
		expect(statusFromServiceState(state({ running: 1, failed: 3 }))).toBe("running");
	});

	it("is running while tasks are still being placed or started", () => {
		expect(statusFromServiceState(state({ pending: 1 }))).toBe("running");
		// Just created: desired > 0 but no tasks scheduled yet.
		expect(statusFromServiceState(state({}))).toBe("running");
	});

	it("is error when tasks crash-loop (repeated failures)", () => {
		expect(statusFromServiceState(state({ failed: 2, pending: 1 }))).toBe("error");
	});

	it("is error after a single failure with no retry in flight", () => {
		expect(statusFromServiceState(state({ failed: 1, pending: 0 }))).toBe("error");
	});

	it("is running during the first retry after a single failure", () => {
		expect(statusFromServiceState(state({ failed: 1, pending: 1 }))).toBe("running");
	});
});

describe("postgresMajorVersion / postgresPgdata", () => {
	it("parses the major version from common image tags", () => {
		expect(postgresMajorVersion("postgres:17")).toBe(17);
		expect(postgresMajorVersion("postgres:18.1-alpine")).toBe(18);
		expect(postgresMajorVersion("registry:5000/library/postgres:16-bookworm")).toBe(16);
		expect(postgresMajorVersion("timescale/timescaledb:2.17.2-pg17")).toBe(17);
		expect(postgresMajorVersion("pgvector/pgvector:pg18")).toBe(18);
		expect(postgresMajorVersion("postgis/postgis:18-3.5")).toBe(18);
	});

	it("returns null for unversioned refs", () => {
		expect(postgresMajorVersion("postgres")).toBeNull();
		expect(postgresMajorVersion("postgres:latest")).toBeNull();
		expect(postgresMajorVersion("ghcr.io/acme/pg:main")).toBeNull();
	});

	it("keeps < 18 on the historical mount root and pins 18+/unversioned under it", () => {
		expect(postgresPgdata("postgres:17")).toBeNull();
		expect(postgresPgdata("postgres:16-alpine")).toBeNull();
		expect(postgresPgdata("postgres:18")).toBe("/var/lib/postgresql/data/pgdata");
		expect(postgresPgdata("postgres:latest")).toBe("/var/lib/postgresql/data/pgdata");
	});

	it("only sets PGDATA in the container env for 18+", () => {
		const row = {
			databaseName: "app",
			databaseUser: "app",
			databasePassword: "pw",
		} as Parameters<typeof DATABASE_CONFIGS.postgres.containerEnv>[0];
		expect(
			DATABASE_CONFIGS.postgres.containerEnv({ ...row, dockerImage: "postgres:17" }),
		).not.toHaveProperty("PGDATA");
		expect(
			DATABASE_CONFIGS.postgres.containerEnv({ ...row, dockerImage: "postgres:18" }),
		).toMatchObject({
			PGDATA: "/var/lib/postgresql/data/pgdata",
		});
	});
});

describe("mongo replica sets are not wired", () => {
	it("never passes --replSet and never advertises replicaSet= in the URL", () => {
		const row = {
			databaseUser: "root",
			databasePassword: "pw",
			replicaSet: "rs0",
		} as Parameters<typeof DATABASE_CONFIGS.mongo.defaultArgs>[0];
		expect(DATABASE_CONFIGS.mongo.defaultArgs(row)).toEqual([]);
		expect(DATABASE_CONFIGS.mongo.connectionUrl(row, "db", 27017)).not.toContain("replicaSet");
	});
});

describe("isManagedDatabaseLabels", () => {
	it("requires the managed label and a known service type", () => {
		expect(
			isManagedDatabaseLabels({ "nixploy.managed": "true", "nixploy.service.type": "postgres" }),
		).toBe(true);
		expect(
			isManagedDatabaseLabels(
				{ "nixploy.managed": "true", "nixploy.service.type": "postgres" },
				"postgres",
			),
		).toBe(true);
		// another engine kind under the same name is still foreign to this router
		expect(
			isManagedDatabaseLabels(
				{ "nixploy.managed": "true", "nixploy.service.type": "redis" },
				"postgres",
			),
		).toBe(false);
		// platform services (install.sh) and applications carry no such labels
		expect(isManagedDatabaseLabels({})).toBe(false);
		expect(isManagedDatabaseLabels(null)).toBe(false);
		expect(isManagedDatabaseLabels({ "nixploy.managed": "true" })).toBe(false);
		expect(isManagedDatabaseLabels({ "nixploy.service.type": "postgres" })).toBe(false);
	});
});
