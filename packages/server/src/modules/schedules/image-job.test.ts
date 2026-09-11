import { afterEach, describe, expect, it } from "vitest";
import {
	assertJobImage,
	buildImageJobCommand,
	jobContainerName,
	jobEnvFilePath,
	scheduleTimeoutMs,
} from "./image-job";

const base = {
	image: "alpine:3.20",
	network: "prod-1a2b3c4d-net",
	envFilePath: "/etc/nixploy/applications/api/job-abc.env",
	containerName: "api-job-abc123",
	shellType: "sh" as const,
	command: "echo hello",
};

describe("buildImageJobCommand", () => {
	it("runs a throwaway container with the hardening baseline", () => {
		const command = buildImageJobCommand(base);
		expect(command).toContain("docker run --rm");
		expect(command).toContain("--cap-drop ALL");
		expect(command).toContain("--security-opt no-new-privileges");
		expect(command).toContain("--pids-limit");
		// NET_RAW stays dropped — ICMP inside containers is deliberately off.
		expect(command).not.toContain("--cap-add NET_RAW");
	});

	it("always overrides the entrypoint", () => {
		// Without this the image's own ENTRYPOINT swallows `sh -c '<command>'`
		// as arguments and the job silently never runs (deploy-hooks gotcha).
		expect(buildImageJobCommand(base)).toContain("--entrypoint sh");
	});

	it("passes env through a file, never on argv", () => {
		const command = buildImageJobCommand(base);
		expect(command).toContain(`--env-file '${base.envFilePath}'`);
		expect(command).not.toMatch(/(^|\s)(-e|--env)\s/);
	});

	it("joins the environment overlay when there is one", () => {
		expect(buildImageJobCommand(base)).toContain("--network 'prod-1a2b3c4d-net'");
	});

	it("omits --network entirely when the environment has no overlay yet", () => {
		const command = buildImageJobCommand({ ...base, network: null });
		expect(command).not.toContain("--network");
		// Still a complete command.
		expect(command).toContain("docker run --rm");
		expect(command).toContain("'alpine:3.20'");
	});

	it("quotes every tenant-controlled value", () => {
		const command = buildImageJobCommand({
			...base,
			command: "echo 'it worked'; rm -rf /",
			image: "alpine:3.20",
			containerName: "api-job-x",
		});
		// The command is ONE quoted argument of `sh -c`, so the `;` cannot
		// escape into the docker line.
		expect(command).toContain(`-c 'echo '\\''it worked'\\''; rm -rf /'`);
		expect(command.indexOf("rm -rf /")).toBeGreaterThan(command.indexOf("-c '"));
	});

	it("falls back to sh when a bash schedule runs an image without bash", () => {
		const command = buildImageJobCommand({ ...base, shellType: "bash" });
		expect(command).toContain("--entrypoint sh");
		expect(command).toContain("command -v bash");
		expect(command).toContain("exec bash -c");
	});
});

describe("jobEnvFilePath / jobContainerName", () => {
	it("puts the env file under the service's own directory", () => {
		expect(jobEnvFilePath("api", "abc-def")).toMatch(/\/applications\/api\/job-abc-def\.env$/);
	});

	it("produces a docker-legal container name", () => {
		const name = jobContainerName("my_app.v2", "550e8400-e29b-41d4-a716-446655440000");
		expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
		expect(name.length).toBeLessThanOrEqual(60);
	});

	it("strips characters docker rejects from the service slug", () => {
		expect(jobContainerName("weird/name:1", "abc")).toBe("weird-name-1-job-abc");
	});
});

describe("assertJobImage", () => {
	it("canonicalizes a plain image ref", () => {
		expect(assertJobImage("alpine:3.20")).toContain("alpine:3.20");
		// An untagged ref is docker's `:latest`, which the parser fills in.
		expect(assertJobImage("alpine")).toContain("alpine:latest");
	});

	it("refuses an empty or malformed ref before it reaches a shell", () => {
		expect(() => assertJobImage(null)).toThrow(/needs an image/);
		expect(() => assertJobImage("   ")).toThrow(/needs an image/);
		expect(() => assertJobImage("alpine:3.20 && rm -rf /")).toThrow(/Invalid image reference/);
		expect(() => assertJobImage("alpine:3.20; id")).toThrow(/Invalid image reference/);
		expect(() => assertJobImage("alpine:$(id)")).toThrow(/Invalid image reference/);
	});
});

describe("scheduleTimeoutMs", () => {
	const original = process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS;
	afterEach(() => {
		if (original === undefined) delete process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS;
		else process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS = original;
	});

	it("falls back to the deploy-hook budget", () => {
		delete process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS;
		expect(scheduleTimeoutMs()).toBe(10 * 60 * 1000);
	});

	it("honours the override", () => {
		process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS = "5000";
		expect(scheduleTimeoutMs()).toBe(5000);
	});

	it("ignores a nonsense override instead of running unbounded", () => {
		process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS = "not-a-number";
		expect(scheduleTimeoutMs()).toBe(10 * 60 * 1000);
		process.env.NIXPLOY_SCHEDULE_TIMEOUT_MS = "-1";
		expect(scheduleTimeoutMs()).toBe(10 * 60 * 1000);
	});
});
