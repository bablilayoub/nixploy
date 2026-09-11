import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runScheduleCommand` builds shell commands from user input (the schedule's
 * command / script, the target service, the shell) and had no tests (audit F8:
 * "11 exec sites, user commands into shell").
 *
 * The assertions are on the EXACT strings, which is what makes them injection
 * guards: every user-controlled value must arrive single-quoted, an inline
 * script must travel on stdin (never in argv), and the container must be
 * resolved from the row's ids rather than from the stored appName.
 */

const calls = vi.hoisted(() => ({
	exec: [] as Array<{ command: string; options?: Record<string, unknown> }>,
	remote: [] as Array<{ serverId: string; command: string; options?: Record<string, unknown> }>,
	stdin: [] as Array<{ command: string; input: string; options?: Record<string, unknown> }>,
	/** Output the next `docker ps -q` lookup returns (shift per call). */
	lookups: [] as string[],
}));

const rows = vi.hoisted(() => ({
	applications: new Map<string, { appName: string; serverId: string | null }>(),
	compose: new Map<string, { appName: string; serverId: string | null }>(),
}));

vi.mock("../../utils/exec", () => {
	return {
		remoteCommandTimeoutMs: () => 60_000,
		execAsync: async (command: string, options?: Record<string, unknown>) => {
			calls.exec.push({ command, options });
			return command.includes("docker ps -q") ? (calls.lookups.shift() ?? "") : "local-output";
		},
		execAsyncRemote: async (
			serverId: string,
			command: string,
			options?: Record<string, unknown>,
		) => {
			calls.remote.push({ serverId, command, options });
			return command.includes("docker ps -q") ? (calls.lookups.shift() ?? "") : "remote-output";
		},
		execAsyncWithStdin: async (
			command: string,
			input: string,
			options?: Record<string, unknown>,
		) => {
			calls.stdin.push({ command, input, options });
			return "stdin-output";
		},
	};
});

vi.mock("../../db", async () => {
	const { createFakeDb, whereValues } = await import("../../test-utils/fake-db");
	const { db } = createFakeDb({
		query: {
			applications: {
				findFirst: (args: unknown) => rows.applications.get(whereValues(args)[0] as string),
			},
			compose: {
				findFirst: (args: unknown) => rows.compose.get(whereValues(args)[0] as string),
			},
		},
	});
	return { db };
});

import { runScheduleCommand, type ScheduleTarget } from "./runner";

const base = {
	shellType: "bash" as const,
	command: "echo hi",
};

beforeEach(() => {
	calls.exec = [];
	calls.remote = [];
	calls.stdin = [];
	calls.lookups = [];
	rows.applications = new Map([
		["app-1", { appName: "api-abc123", serverId: null }],
		["app-remote", { appName: "api-remote", serverId: "srv-1" }],
	]);
	rows.compose = new Map([["cmp-1", { appName: "stack-abc123", serverId: null }]]);
});

describe("application / compose schedules", () => {
	it("re-derives the appName from applicationId, not from the stored appName", async () => {
		calls.lookups = ["container-1"];
		const target: ScheduleTarget = {
			...base,
			scheduleType: "application",
			applicationId: "app-1",
			// A stale/tampered name must never reach the docker filter.
			appName: "attacker-app",
		};

		await runScheduleCommand(target);

		expect(calls.exec[0]?.command).toBe(
			"docker ps -q --filter 'label=com.docker.swarm.service.name=api-abc123' | head -n 1",
		);
	});

	it("execs the command inside the resolved container, single-quoted", async () => {
		calls.lookups = ["container-1"];

		await expect(
			runScheduleCommand({ ...base, scheduleType: "application", applicationId: "app-1" }),
		).resolves.toBe("local-output");

		expect(calls.exec[1]).toEqual({
			command: "docker exec 'container-1' bash -c 'echo hi'",
			options: { timeout: 60_000 },
		});
	});

	it("quotes a command that tries to break out of the -c argument", async () => {
		calls.lookups = ["container-1"];

		await runScheduleCommand({
			...base,
			scheduleType: "application",
			applicationId: "app-1",
			command: "echo '; rm -rf /",
		});

		expect(calls.exec[1]?.command).toBe(`docker exec 'container-1' bash -c 'echo '\\''; rm -rf /'`);
	});

	it("sends an inline script over stdin instead of argv", async () => {
		calls.lookups = ["container-1"];

		await expect(
			runScheduleCommand({
				...base,
				scheduleType: "application",
				applicationId: "app-1",
				shellType: "sh",
				script: "#!/bin/sh\necho from-script\n",
			}),
		).resolves.toBe("stdin-output");

		expect(calls.stdin).toEqual([
			{
				command: "docker exec -i 'container-1' sh -s",
				input: "#!/bin/sh\necho from-script\n",
				options: { serverId: null, timeout: 60_000 },
			},
		]);
		// The script never appears in a command string.
		expect(calls.exec.some((call) => call.command.includes("from-script"))).toBe(false);
	});

	it("tries the compose and stack labels in order for a compose schedule", async () => {
		calls.lookups = ["", "container-2"];

		await runScheduleCommand({ ...base, scheduleType: "compose", composeId: "cmp-1" });

		expect(calls.exec.map((call) => call.command)).toEqual([
			"docker ps -q --filter 'label=com.docker.compose.project=stack-abc123' | head -n 1",
			"docker ps -q --filter 'label=com.docker.stack.namespace=stack-abc123' | head -n 1",
			"docker exec 'container-2' bash -c 'echo hi'",
		]);
	});

	it("runs against the service's own server when the row is pinned", async () => {
		calls.lookups = ["container-3"];

		await expect(
			runScheduleCommand({ ...base, scheduleType: "application", applicationId: "app-remote" }),
		).resolves.toBe("remote-output");

		expect(calls.exec).toEqual([]);
		expect(calls.remote.map((call) => [call.serverId, call.command])).toEqual([
			[
				"srv-1",
				"docker ps -q --filter 'label=com.docker.swarm.service.name=api-remote' | head -n 1",
			],
			["srv-1", "docker exec 'container-3' bash -c 'echo hi'"],
		]);
	});

	it("fails with PRECONDITION_FAILED when no container is running", async () => {
		calls.lookups = [""];

		await expect(
			runScheduleCommand({ ...base, scheduleType: "application", applicationId: "app-1" }),
		).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: "No running container found for api-abc123",
		});
	});

	it("fails when neither the ids nor a stored appName resolve", async () => {
		await expect(
			runScheduleCommand({ ...base, scheduleType: "application", applicationId: "gone" }),
		).rejects.toMatchObject({
			code: "PRECONDITION_FAILED",
			message: "Schedule has no appName and its target service could not be resolved",
		});
	});
});

describe("server schedules", () => {
	it("runs the raw command over SSH on the schedule's server", async () => {
		await expect(
			runScheduleCommand({ ...base, scheduleType: "server", serverId: "srv-9" }),
		).resolves.toBe("remote-output");

		expect(calls.remote).toEqual([{ serverId: "srv-9", command: "echo hi", options: undefined }]);
	});

	it("streams a script to `<shell> -s` on the server", async () => {
		await runScheduleCommand({
			...base,
			scheduleType: "server",
			serverId: "srv-9",
			shellType: "sh",
			script: "echo remote-script",
		});

		expect(calls.stdin).toEqual([
			{ command: "sh -s", input: "echo remote-script", options: { serverId: "srv-9" } },
		]);
	});

	it("rejects a server schedule with no serverId", async () => {
		await expect(runScheduleCommand({ ...base, scheduleType: "server" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Server schedule is missing serverId",
		});
	});
});

describe("nixploy-server schedules", () => {
	it("runs locally under the remote command timeout", async () => {
		await expect(runScheduleCommand({ ...base, scheduleType: "nixploy-server" })).resolves.toBe(
			"local-output",
		);

		expect(calls.exec).toEqual([{ command: "echo hi", options: { timeout: 60_000 } }]);
	});

	it("streams a script on stdin, bounded by the same timeout", async () => {
		await runScheduleCommand({
			...base,
			scheduleType: "nixploy-server",
			script: "echo panel-script",
		});

		expect(calls.stdin).toEqual([
			{ command: "bash -s", input: "echo panel-script", options: { timeout: 60_000 } },
		]);
	});
});
