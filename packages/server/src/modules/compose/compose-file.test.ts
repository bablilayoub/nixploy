import { describe, expect, it } from "vitest";
import {
	assertSafeComposeSpec,
	buildDeployComposeFile,
	hostPrivilegedComposeSafety,
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

describe("assertSafeComposeSpec", () => {
	it("rejects shared namespaces, external volumes, and service: network_mode", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    network_mode: service:other
`),
			),
		).toThrow(/network_mode/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes: [data:/data]
volumes:
  data:
    external: true
`),
			),
		).toThrow(/external/);
	});

	it("rejects extra_hosts and sysctls unless host-privileged", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    extra_hosts: ["metadata.google.internal:1.2.3.4"]
`),
			),
		).toThrow(/extra_hosts/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    sysctls:
      - net.ipv4.ip_forward=1
`),
			),
		).toThrow(/sysctls/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    sysctls:
      - net.ipv4.ip_forward=1
`),
				hostPrivilegedComposeSafety(),
			),
		).not.toThrow();
	});

	it("rejects docker.sock mounts", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
`),
			),
		).toThrow(/Docker socket/);
	});

	it("rejects privileged and traefik labels", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    privileged: true
`),
			),
		).toThrow(/privileged/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    labels:
      traefik.enable: "true"
`),
			),
		).toThrow(/Traefik labels/);
	});

	it("rejects host-published ports", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    ports: ["8080:80"]
`),
			),
		).toThrow(/publish host ports/);
	});

	it("rejects named-volume bind driver_opts and cap_add ALL", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes: [evil:/mnt]
volumes:
  evil:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /etc
`),
			),
		).toThrow(/driver_opts/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    cap_add: [ALL]
`),
			),
		).toThrow(/ALL/);
	});

	it("rejects configs/secrets file host reads", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
configs:
  secretish:
    file: /etc/passwd
`),
			),
		).toThrow(/file:/);
	});

	it("rejects long-form type: bind and map-shaped volumes", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes:
      - type: bind
        source: /etc
        target: /stolen
`),
			),
		).toThrow(/type: bind/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes:
      data: /etc:/stolen
`),
			),
		).toThrow(/volumes must be an array/);
	});

	it("host-privileged options allow docker.sock and NET_ADMIN only", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`),
				hostPrivilegedComposeSafety(),
			),
		).not.toThrow();
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    cap_add: [NET_ADMIN, SYS_MODULE]
    volumes: [data:/data]
`),
				hostPrivilegedComposeSafety(),
			),
		).not.toThrow();
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes:
      - /etc:/stolen
`),
				hostPrivilegedComposeSafety(),
			),
		).toThrow(/bind-mount host paths/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    cap_add: [SYS_ADMIN]
`),
				hostPrivilegedComposeSafety(),
			),
		).toThrow(/SYS_ADMIN/);
	});

	it("rejects include, build, host binds, and env interpolation in dangerous fields", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`include:
  - path: ./evil.yml
services:
  x:
    image: alpine
`),
			),
		).toThrow(/include/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    build:
      context: ../../
`),
			),
		).toThrow(/build:/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes: ["../.env:/stolen:ro"]
`),
			),
		).toThrow(/bind-mount host paths/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    privileged: "\${P}"
`),
			),
		).toThrow(/env interpolation/);
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
