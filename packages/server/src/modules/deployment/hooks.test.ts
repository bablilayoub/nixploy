import { afterEach, describe, expect, it } from "vitest";
import {
	buildFindContainerCommand,
	buildPostDeployCommand,
	buildPreDeployCommand,
	composeProjectLabel,
	composeStackLabel,
	DEFAULT_HOOK_TIMEOUT_MS,
	hardeningFlags,
	hookContainerName,
	hookTimeoutMs,
	swarmServiceLabel,
} from "./hooks";

const ORIGINAL = process.env.NIXPLOY_HOOK_TIMEOUT_MS;

afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.NIXPLOY_HOOK_TIMEOUT_MS;
	else process.env.NIXPLOY_HOOK_TIMEOUT_MS = ORIGINAL;
});

describe("buildPreDeployCommand", () => {
	it("runs a throwaway hardened container on the environment overlay", () => {
		expect(
			buildPreDeployCommand({
				image: "echo-4a4487:latest",
				network: "production-1a2b3c4d-net",
				envFilePath: "/etc/nixploy/applications/echo-4a4487/hook-dep1.env",
				containerName: "echo-4a4487-hook-dep1",
				command: "npm run migrate",
			}),
		).toBe(
			"docker run --rm " +
				"--name 'echo-4a4487-hook-dep1' " +
				"--network 'production-1a2b3c4d-net' " +
				"--env-file '/etc/nixploy/applications/echo-4a4487/hook-dep1.env' " +
				"--cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER " +
				"--cap-add KILL --cap-add NET_BIND_SERVICE --cap-add SETGID --cap-add SETUID " +
				"--security-opt no-new-privileges --pids-limit 1024 " +
				// Without --entrypoint the image's ENTRYPOINT swallows the command
				// (traefik/whoami starts its server and the hook never runs).
				"--entrypoint sh " +
				"'echo-4a4487:latest' " +
				"-c 'npm run migrate'",
		);
	});

	it("quotes a command that tries to break out of the shell argument", () => {
		const command = buildPreDeployCommand({
			image: "app:latest",
			network: "net",
			envFilePath: "/tmp/a.env",
			containerName: "app-hook",
			command: "echo 'x'; rm -rf /",
		});
		// The whole payload stays inside ONE quoted argument to `sh -c`.
		expect(command.endsWith(`-c 'echo '\\''x'\\''; rm -rf /'`)).toBe(true);
		expect(command).toContain("--entrypoint sh");
	});

	it("carries the same hardening the swarm spec applies", () => {
		expect(hardeningFlags()).toContain("--cap-drop ALL");
		expect(hardeningFlags()).toContain("--security-opt no-new-privileges");
		expect(hardeningFlags()).toContain("--pids-limit 1024");
	});
});

describe("buildPostDeployCommand", () => {
	it("execs into one running container", () => {
		expect(buildPostDeployCommand("abc123", "php artisan cache:warm")).toBe(
			"docker exec 'abc123' sh -c 'php artisan cache:warm'",
		);
	});
});

describe("buildFindContainerCommand", () => {
	it("filters running containers by label", () => {
		expect(buildFindContainerCommand(swarmServiceLabel("echo-4a4487"))).toBe(
			"docker ps --filter 'label=com.docker.swarm.service.name=echo-4a4487' --filter status=running --format '{{.ID}}'",
		);
		expect(composeProjectLabel("stack-1")).toBe("com.docker.compose.project=stack-1");
		expect(composeStackLabel("stack-1")).toBe("com.docker.stack.namespace=stack-1");
	});
});

describe("hookContainerName", () => {
	it("derives a docker-safe name from the deployment id", () => {
		expect(hookContainerName("echo-4a4487", "b1f0c3d2-4e5f-6789-abcd-ef0123456789")).toBe(
			"echo-4a4487-hook-b1f0c3d24e5f",
		);
	});

	it("never exceeds the container name budget", () => {
		expect(hookContainerName("a".repeat(80), "dep").length).toBeLessThanOrEqual(60);
	});
});

describe("hookTimeoutMs", () => {
	it("defaults to ten minutes and honours the override", () => {
		delete process.env.NIXPLOY_HOOK_TIMEOUT_MS;
		expect(hookTimeoutMs()).toBe(DEFAULT_HOOK_TIMEOUT_MS);
		process.env.NIXPLOY_HOOK_TIMEOUT_MS = "5000";
		expect(hookTimeoutMs()).toBe(5000);
		process.env.NIXPLOY_HOOK_TIMEOUT_MS = "not-a-number";
		expect(hookTimeoutMs()).toBe(DEFAULT_HOOK_TIMEOUT_MS);
	});
});
