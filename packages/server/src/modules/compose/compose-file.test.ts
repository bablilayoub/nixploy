import { describe, expect, it } from "vitest";
import {
	buildDeployComposeFile,
	listComposeServices,
	mergeEnvVars,
	parseComposeFile,
	randomizeServiceNames,
} from "./compose-file";

const COMPOSE = `
services:
  web:
    image: nginx:latest
    depends_on:
      - db
  db:
    image: postgres:16
  worker:
    image: busybox
    links:
      - db:database
`;

describe("parseComposeFile / listComposeServices", () => {
	it("extracts service names from compose YAML", () => {
		expect(listComposeServices(COMPOSE)).toEqual(["web", "db", "worker"]);
	});

	it("preserves service declaration order", () => {
		const content = "services:\n  zebra:\n    image: z\n  alpha:\n    image: a\n";
		expect(listComposeServices(content)).toEqual(["zebra", "alpha"]);
	});

	it("throws on YAML that is not a mapping", () => {
		expect(() => parseComposeFile("just a string")).toThrow(
			"Invalid compose file: not a YAML mapping",
		);
		// A YAML list is an object but has no services key.
		expect(() => parseComposeFile("- just\n- a\n- list")).toThrow(
			"Invalid compose file: no services defined",
		);
	});

	it("throws when no services are defined", () => {
		expect(() => parseComposeFile("version: '3'")).toThrow(
			"Invalid compose file: no services defined",
		);
		expect(() => parseComposeFile("services: {}")).toThrow(
			"Invalid compose file: no services defined",
		);
	});
});

describe("randomizeServiceNames", () => {
	it("suffixes services and rewrites depends_on/links references", () => {
		const spec = parseComposeFile(COMPOSE);
		const renamed = randomizeServiceNames(spec, "abc123");
		expect(Object.keys(renamed.services ?? {})).toEqual([
			"web-abc123",
			"db-abc123",
			"worker-abc123",
		]);
		expect(renamed.services?.["web-abc123"]?.depends_on).toEqual(["db-abc123"]);
		expect(renamed.services?.["worker-abc123"]?.links).toEqual(["db-abc123:database"]);
	});

	it("is a no-op without a suffix", () => {
		const spec = parseComposeFile(COMPOSE);
		expect(randomizeServiceNames(spec, "")).toBe(spec);
	});
});

describe("buildDeployComposeFile", () => {
	it("attaches every service to the nixploy-network with an alias (docker-compose mode)", () => {
		const output = buildDeployComposeFile("services:\n  web:\n    image: nginx\n", {
			appName: "myapp",
			composeType: "docker-compose",
		});
		const spec = parseComposeFile(output);
		expect(spec.networks?.["nixploy-network"]).toEqual({
			external: true,
			name: "nixploy-network",
		});
		const networks = spec.services?.web?.networks as Record<string, { aliases?: string[] }>;
		expect(networks["nixploy-network"]?.aliases).toEqual(["myapp-web"]);
	});

	it("applies the suffix before network injection", () => {
		const output = buildDeployComposeFile("services:\n  web:\n    image: nginx\n", {
			appName: "myapp",
			composeType: "docker-compose",
			suffix: "pr-1",
		});
		expect(listComposeServices(output)).toEqual(["web-pr-1"]);
	});
});

describe("mergeEnvVars", () => {
	it("later sources override earlier ones, dropping comments and blanks", () => {
		const merged = mergeEnvVars("A=1\nB=base\n# comment\n", "B=override\n\nC=3", null, undefined);
		expect(merged).toBe("A=1\nB=override\nC=3");
	});
});
