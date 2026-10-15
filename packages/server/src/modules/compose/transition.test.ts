import { describe, expect, it, vi } from "vitest";
import { COMPOSE_SOURCE_SERVICE_LABEL } from "./commands";
import { assertSafeComposeNamingTransition } from "./transition";

const row = { appName: "stack-a", composeType: "docker-compose" as const };
const container = (volume: string, labels: Record<string, string> = {}) => ({
	Config: {
		Labels: {
			"com.docker.compose.project": "stack-a",
			"com.docker.compose.service": "db",
			...labels,
		},
	},
	Mounts: [{ Type: "volume", Name: volume, Destination: "/data" }],
});
const runner = (containers: unknown[]) =>
	vi.fn().mockResolvedValueOnce("abc123456789\n").mockResolvedValueOnce(JSON.stringify(containers));

describe("Compose service naming upgrade", () => {
	it("preserves legacy anonymous/image volume data by refusing before any mutation", async () => {
		const run = runner([container("a".repeat(64))]);
		await expect(assertSafeComposeNamingTransition(row, run)).rejects.toThrow(
			/anonymous volume at \/data/,
		);
		expect(run.mock.calls.map(([command]) => command)).toEqual([
			"docker ps -aq --filter label=com.docker.compose.project='stack-a'",
			"docker inspect 'abc123456789'",
		]);
	});

	it("allows declared named volumes and keeps already-upgraded anonymous identities stable", async () => {
		await expect(
			assertSafeComposeNamingTransition(row, runner([container("stack-a_data")])),
		).resolves.toBeUndefined();
		await expect(
			assertSafeComposeNamingTransition(
				row,
				runner([
					container("b".repeat(64), {
						[COMPOSE_SOURCE_SERVICE_LABEL]: "db",
						"com.docker.compose.service": "stack-a-db",
					}),
				]),
			),
		).resolves.toBeUndefined();
	});

	it("does not inspect another Compose project's data", async () => {
		await expect(
			assertSafeComposeNamingTransition(
				row,
				runner([container("a".repeat(64), { "com.docker.compose.project": "other" })]),
			),
		).resolves.toBeUndefined();
	});

	it("does not interpolate unexpected Docker output into an inspect command", async () => {
		const run = vi.fn().mockResolvedValue("not-a-container-id");
		await expect(assertSafeComposeNamingTransition(row, run)).rejects.toThrow(/Could not verify/);
		expect(run).toHaveBeenCalledTimes(1);
	});
});

const swarmRow = { appName: "stack-a", composeType: "stack" as const };
const swarmService = (name: string, source?: string) => ({
	Spec: {
		Name: name,
		Labels: { "com.docker.stack.namespace": "stack-a" },
		TaskTemplate: {
			ContainerSpec: { Labels: source ? { [COMPOSE_SOURCE_SERVICE_LABEL]: source } : {} },
		},
	},
});

describe("Swarm naming transition", () => {
	it.each(["stack-a_db", "stack-a_app"])(
		"refuses every legacy service %s without inspecting only local tasks",
		async (name) => {
			const run = vi
				.fn()
				.mockResolvedValueOnce("a".repeat(25))
				.mockResolvedValueOnce(JSON.stringify([swarmService(name)]));
			await expect(assertSafeComposeNamingTransition(swarmRow, run)).rejects.toThrow(
				/Before stopping.*anonymous\/image volumes.*target node placement.*wait for every old task/,
			);
			expect(run.mock.calls.map(([command]) => command)).toEqual([
				"docker service ls -q --no-trunc --filter label=com.docker.stack.namespace='stack-a'",
				`docker service inspect '${"a".repeat(25)}'`,
			]);
		},
	);
	it("requires physical identity as well as source metadata, and permits qualified redeploys", async () => {
		const run = (service: unknown) =>
			vi
				.fn()
				.mockResolvedValueOnce("a".repeat(25))
				.mockResolvedValueOnce(JSON.stringify([service]));
		await expect(
			assertSafeComposeNamingTransition(swarmRow, run(swarmService("stack-a_db", "db"))),
		).rejects.toThrow(/legacy service names/);
		await expect(
			assertSafeComposeNamingTransition(swarmRow, run(swarmService("stack-a_stack-a-db", "db"))),
		).resolves.toBeUndefined();
	});
	it("permits a stopped/new stack and rejects unexpected service IDs before inspect", async () => {
		await expect(
			assertSafeComposeNamingTransition(swarmRow, vi.fn().mockResolvedValue("")),
		).resolves.toBeUndefined();
		const run = vi.fn().mockResolvedValue("bad; command");
		await expect(assertSafeComposeNamingTransition(swarmRow, run)).rejects.toThrow(
			/Could not verify/,
		);
		expect(run).toHaveBeenCalledTimes(1);
	});
});

it("refuses lingering Swarm task containers after service objects disappeared", async () => {
	const run = vi.fn().mockResolvedValueOnce("");
	const nodes = vi.fn().mockResolvedValue("abc123456789\n");
	await expect(assertSafeComposeNamingTransition(swarmRow, run, nodes)).rejects.toThrow(
		/task containers are still stopping/,
	);
	expect(nodes).toHaveBeenCalledWith(
		"docker ps -aq --filter label=com.docker.stack.namespace='stack-a'",
	);
});
