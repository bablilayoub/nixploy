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
				runner([container("b".repeat(64), { [COMPOSE_SOURCE_SERVICE_LABEL]: "db" })]),
			),
		).resolves.toBeUndefined();
	});

	it("leaves Swarm naming unchanged and does not inspect another project's data", async () => {
		const run = vi.fn();
		await assertSafeComposeNamingTransition({ ...row, composeType: "stack" }, run);
		expect(run).not.toHaveBeenCalled();
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
