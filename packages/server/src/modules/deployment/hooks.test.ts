import { afterEach, describe, expect, it } from "vitest";
import {
	buildFindContainerCommand,
	buildPostDeployCommand,
	buildPreDeployCommand,
	buildPreDeployContainerOptions,
	composeProjectLabel,
	composeStackLabel,
	DEFAULT_HOOK_TIMEOUT_MS,
	DEPLOYMENT_HOOK_LABEL,
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

describe("pre-deploy transport", () => {
	it("creates a hardened shell container through Engine configuration with exact env bytes", () => {
		const options = buildPreDeployContainerOptions({
			appName: "app",
			deploymentId: "job",
			image: "app:latest",
			network: "env-net",
			env: 'GREETING="hello world"\nMULTI="one\\ntwo"\nLITERAL=\'"quotes"\'\nEMPTY=',
			command: "npm run migrate",
		});
		expect(options.Env).toEqual([
			"GREETING=hello world",
			"MULTI=one\ntwo",
			'LITERAL="quotes"',
			"EMPTY=",
		]);
		expect(options.Entrypoint).toEqual(["sh"]);
		expect(options.Cmd).toEqual(["-c", "npm run migrate"]);
		expect(options.Labels).toMatchObject({ [DEPLOYMENT_HOOK_LABEL]: "job" });
		expect(options.HostConfig).toMatchObject({
			NetworkMode: "env-net",
			AutoRemove: true,
			CapDrop: ["ALL"],
			SecurityOpt: ["no-new-privileges"],
			PidsLimit: 1024,
		});
	});
	it("puts neither variable values nor hook commands on the CLI command line", () => {
		expect(buildPreDeployCommand("a".repeat(64))).toBe(`docker start -a '${"a".repeat(64)}'`);
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
