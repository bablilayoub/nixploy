import { describe, expect, it } from "vitest";
import {
	applyComposeHardening,
	assertSafeComposeSpec,
	buildDeployComposeFile,
	composeEnvMap,
	escapeComposeInterpolation,
	hostPrivilegedComposeSafety,
	injectNetwork,
	interpolateComposeString,
	listComposeServices,
	mergeEnvVars,
	parseComposeFile,
	randomizeServiceNames,
	renderComposeSpec,
	shouldRedactEnvValue,
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

describe("interpolateComposeString", () => {
	const env = { A: "alpha", EMPTY: "", HOST: "db" };

	it(`expands $VAR and \${VAR}, unknown variables to the empty string`, () => {
		expect(interpolateComposeString(`$A/\${A}/$MISSING/\${MISSING}!`, env)).toBe("alpha/alpha//!");
	});

	it("supports :- and - defaults with compose semantics", () => {
		expect(interpolateComposeString(`\${MISSING:-x}`, env)).toBe("x");
		expect(interpolateComposeString(`\${EMPTY:-x}`, env)).toBe("x");
		expect(interpolateComposeString(`\${EMPTY-x}`, env)).toBe("");
		expect(interpolateComposeString(`\${MISSING-x}`, env)).toBe("x");
		expect(interpolateComposeString(`\${A:-x}`, env)).toBe("alpha");
	});

	it("supports :? / ? errors and :+ / + alternates", () => {
		expect(() => interpolateComposeString(`\${MISSING:?need it}`, env)).toThrow(/MISSING.*need it/);
		expect(() => interpolateComposeString(`\${EMPTY:?need it}`, env)).toThrow(/EMPTY/);
		expect(interpolateComposeString(`\${EMPTY?need it}`, env)).toBe("");
		expect(interpolateComposeString(`\${A:+set}`, env)).toBe("set");
		expect(interpolateComposeString(`\${EMPTY:+set}`, env)).toBe("");
		expect(interpolateComposeString(`\${EMPTY+set}`, env)).toBe("set");
	});

	it("handles nested defaults, $$ escapes and stray dollars", () => {
		expect(interpolateComposeString(`\${MISSING:-\${HOST}:5432}`, env)).toBe("db:5432");
		expect(interpolateComposeString(`cost: $$5 and $$\${A}`, env)).toBe("cost: $5 and $alpha");
		expect(interpolateComposeString("$1 $ end", env)).toBe("$1 $ end");
	});

	it("rejects malformed templates", () => {
		expect(() => interpolateComposeString(`\${A`, env)).toThrow(/unterminated/);
		expect(() => interpolateComposeString(`\${9x}`, env)).toThrow(/Invalid compose interpolation/);
		expect(() => interpolateComposeString(`\${A%x}`, env)).toThrow(/Invalid compose interpolation/);
	});
});

describe("renderComposeSpec", () => {
	it("interpolates every string and resolves bare environment keys from the merged env only", () => {
		const spec = parseComposeFile(`services:
  app:
    image: "ghcr.io/x/app:\${TAG:-latest}"
    environment:
      - DB_PASSWORD
      - ENCRYPTION_KEY
      - PLAIN=1
    command: ["sh", "-c", "echo $$HOME $TAG"]
  db:
    image: postgres
    environment:
      POSTGRES_PASSWORD:
      DATABASE_URL:
      LITERAL: "\${TAG}"
`);
		const rendered = renderComposeSpec(spec, {
			TAG: "v2",
			DB_PASSWORD: "pw",
			POSTGRES_PASSWORD: "pw",
		});
		expect(rendered.services?.app?.image).toBe("ghcr.io/x/app:v2");
		// ENCRYPTION_KEY is not in the tenant env: dropped, never taken from the panel process.
		expect(rendered.services?.app?.environment).toEqual(["DB_PASSWORD=pw", "PLAIN=1"]);
		expect(rendered.services?.app?.command).toEqual(["sh", "-c", "echo $HOME v2"]);
		expect(rendered.services?.db?.environment).toEqual({
			POSTGRES_PASSWORD: "pw",
			LITERAL: "v2",
		});
		// input untouched
		expect(spec.services?.app?.image).toBe(`ghcr.io/x/app:\${TAG:-latest}`);
	});

	it("escapeComposeInterpolation doubles every dollar for Docker's own pass", () => {
		const spec = { services: { x: { image: "a", command: "echo $HOME $$" } } };
		expect(escapeComposeInterpolation(spec).services?.x?.command).toBe("echo $$HOME $$$$");
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

	it("rejects env_file host path reads", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    env_file: [/etc/nixploy/secrets.env]
`),
			),
		).toThrow(/env_file/);
	});

	it("rejects secrets/configs environment and external", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
secrets:
  k:
    environment: ENCRYPTION_KEY
`),
			),
		).toThrow(/environment/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
configs:
  c:
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
		// Unbraced `$VAR` is valid compose interpolation too.
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    cap_add: [$CAP]
`),
			),
		).toThrow(/env interpolation/);
	});

	it("treats ~ and $ prefixed volume sources as host binds", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes: ["~/.ssh:/stolen:ro"]
`),
			),
		).toThrow(/bind-mount host paths/);
		expect(() =>
			assertSafeComposeSpec({
				services: {
					x: { image: "alpine", volumes: [{ type: "volume", source: "~", target: "/h" }] },
				},
			}),
		).toThrow(/bind-mount host paths/);
		expect(() =>
			assertSafeComposeSpec({
				services: { x: { image: "alpine", volumes: ["$$HOME:/h"] } },
			}),
		).toThrow(/env interpolation/);
	});

	it("rejects name: on top-level volumes, configs and secrets (cross-tenant mounts)", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    volumes: [data:/var/lib/postgresql/data]
volumes:
  data:
    name: nixploy-postgres-data
`),
			),
		).toThrow(/must not set name:/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
configs:
  c:
    name: other-tenant-config
`),
			),
		).toThrow(/must not set name:/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
secrets:
  s:
    name: other-tenant-secret
`),
			),
		).toThrow(/must not set name:/);
	});

	it("rejects tenant-declared external / named / non-bridge networks", () => {
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    networks: [shared]
networks:
  shared:
    external: true
    name: nixploy-network
`),
			),
		).toThrow(/must not use external/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
networks:
  shared:
    name: victim-app_default
`),
			),
		).toThrow(/must not set name:/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
networks:
  lan:
    driver: macvlan
`),
			),
		).toThrow(/driver macvlan/);
		expect(() =>
			assertSafeComposeSpec(
				parseComposeFile(`services:
  x:
    image: alpine
    networks: [internal]
networks:
  internal:
    driver: bridge
    internal: true
`),
			),
		).not.toThrow();
	});
});

/**
 * The bypasses from the audit: every dangerous value is a plain env
 * reference, resolved from the tenant-controlled `.env` at deploy time. The
 * rendered spec (what Docker runs) must be the one that is validated.
 */
describe("interpolation bypasses", () => {
	const env = { P: "true", NM: "host", PID: "host", CAP: "SYS_ADMIN", V: "/", L: "traefik.enable" };

	it.each([
		["privileged: $P", { privileged: "$P" }, /privileged: true/],
		["network_mode: $NM", { network_mode: "$NM" }, /network_mode/],
		["pid: $PID", { pid: "$PID" }, /pid/],
		["cap_add: [$CAP]", { cap_add: ["$CAP"] }, /SYS_ADMIN/],
		["volumes: [$V:/host]", { volumes: ["$V:/host"] }, /bind-mount host paths/],
		["volumes: [~/.ssh:/x]", { volumes: ["~/.ssh:/stolen"] }, /bind-mount host paths/],
		[`labels: [\${L}=true]`, { labels: [`\${L}=true`] }, /Traefik labels/],
	])("rendered spec rejects %s", (_label, fields, error) => {
		const spec = { services: { x: { image: "alpine", ...fields } } };
		expect(() => assertSafeComposeSpec(renderComposeSpec(spec, env))).toThrow(error);
	});

	it("buildDeployComposeFile validates the env-rendered file", () => {
		const content = `services:
  x:
    image: alpine
    labels:
      - "\${L}=true"
`;
		const input = { appName: "app", composeType: "docker-compose" as const };
		expect(() => buildDeployComposeFile(content, { ...input, env })).toThrow(/Traefik labels/);
		expect(() => buildDeployComposeFile(content, { ...input, env: {} })).not.toThrow();
		expect(() =>
			buildDeployComposeFile("services:\n  x:\n    image: alpine\n    privileged: $P\n", {
				...input,
				env,
			}),
		).toThrow(/env interpolation/);
	});
});

describe("injectNetwork", () => {
	const spec = parseComposeFile(`services:
  web:
    image: nginx
    networks: [nixploy-network]
  db:
    image: postgres
  cache:
    image: redis
    networks:
      backend:
        aliases: [redis-primary]
networks:
  backend: {}
`);

	it("keeps every service on a private per-app network and exposes only Traefik targets", () => {
		const out = injectNetwork(spec, {
			appName: "shop",
			composeType: "docker-compose",
			exposedServices: ["web"],
		});
		expect(out.networks?.["shop-net"]).toEqual({ name: "shop-net" });
		expect(out.networks?.["nixploy-network"]).toEqual({
			external: true,
			name: "nixploy-network",
		});
		expect(out.networks?.backend).toEqual({});
		expect(out.services?.web?.networks).toEqual({
			"shop-net": {},
			"nixploy-network": { aliases: ["shop-web"] },
		});
		// db never joins the shared overlay: `db` only resolves inside this stack.
		expect(out.services?.db?.networks).toEqual({ "shop-net": {} });
		expect(out.services?.cache?.networks).toEqual({
			backend: { aliases: ["redis-primary"] },
			"shop-net": {},
		});
	});

	it("drops the shared network entirely when nothing is exposed", () => {
		const out = injectNetwork(spec, { appName: "shop", composeType: "docker-compose" });
		expect(out.networks?.["nixploy-network"]).toBeUndefined();
		for (const service of Object.values(out.services ?? {})) {
			expect(Object.keys(service.networks ?? {})).not.toContain("nixploy-network");
		}
	});

	it("uses an attachable overlay for stacks and still aliases exposed services", () => {
		const out = injectNetwork(spec, {
			appName: "shop",
			composeType: "stack",
			exposedServices: ["web", "db"],
		});
		expect(out.networks?.["shop-net"]).toEqual({
			name: "shop-net",
			driver: "overlay",
			attachable: true,
		});
		expect(out.services?.db?.networks).toEqual({
			"shop-net": {},
			"nixploy-network": { aliases: ["shop-db"] },
		});
		expect(out.services?.cache?.networks).toEqual({
			backend: { aliases: ["redis-primary"] },
			"shop-net": {},
		});
	});
});

describe("buildDeployComposeFile", () => {
	it("renders env values, escapes leftover dollars and wires networks", () => {
		const output = buildDeployComposeFile(
			`services:
  web:
    image: "nginx:\${TAG}"
    command: ["sh", "-c", "echo $$PATH"]
  db:
    image: postgres
`,
			{
				appName: "myapp",
				composeType: "docker-compose",
				env: { TAG: "1.27" },
				exposedServices: ["web"],
			},
		);
		expect(output).toContain("nginx:1.27");
		expect(output).toContain("$$PATH");
		expect(output).not.toContain(`\${TAG}`);
		const spec = parseComposeFile(output);
		expect(spec.networks?.["nixploy-network"]).toEqual({
			external: true,
			name: "nixploy-network",
		});
		expect(spec.services?.web?.networks).toEqual({
			"myapp-net": {},
			"nixploy-network": { aliases: ["myapp-web"] },
		});
		expect(spec.services?.db?.networks).toEqual({ "myapp-net": {} });
	});

	it("applies the suffix before network injection and to the exposed set / alias", () => {
		const output = buildDeployComposeFile("services:\n  web:\n    image: nginx\n", {
			appName: "myapp",
			composeType: "docker-compose",
			suffix: "pr-1",
			exposedServices: ["web"],
		});
		expect(listComposeServices(output)).toEqual(["web-pr-1"]);
		const spec = parseComposeFile(output);
		expect(spec.services?.["web-pr-1"]?.networks).toEqual({
			"myapp-net": {},
			"nixploy-network": { aliases: ["myapp-web-pr-1"] },
		});
	});

	it("pins every stack service to the row's swarm node, merging user constraints", () => {
		const output = buildDeployComposeFile(
			`services:
  web:
    image: nginx
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.role==worker
          - node.id==stale
  db:
    image: postgres
`,
			{ appName: "myapp", composeType: "stack", swarmNodeId: "node123" },
		);
		const spec = parseComposeFile(output);
		expect(spec.services?.web?.deploy).toEqual({
			replicas: 2,
			placement: { constraints: ["node.role==worker", "node.id==node123"] },
		});
		expect(spec.services?.db?.deploy).toEqual({
			placement: { constraints: ["node.id==node123"] },
		});
	});

	it("adds no placement without a swarmNodeId, and never for plain compose", () => {
		const content = "services:\n  web:\n    image: nginx\n";
		const stack = parseComposeFile(
			buildDeployComposeFile(content, { appName: "myapp", composeType: "stack" }),
		);
		expect(stack.services?.web?.deploy).toBeUndefined();
		const plain = parseComposeFile(
			buildDeployComposeFile(content, {
				appName: "myapp",
				composeType: "docker-compose",
				swarmNodeId: "node123",
			}),
		);
		expect(plain.services?.web?.deploy).toBeUndefined();
	});

	it("normalizes stack files: drops top-level name and flattens long-form depends_on", () => {
		const output = buildDeployComposeFile(
			`name: tenant-project
services:
  web:
    image: nginx
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres
`,
			{ appName: "myapp", composeType: "stack" },
		);
		const spec = parseComposeFile(output);
		expect(spec.name).toBeUndefined();
		expect(spec.services?.web?.depends_on).toEqual(["db"]);
		expect(spec.networks?.["myapp-net"]).toEqual({
			name: "myapp-net",
			driver: "overlay",
			attachable: true,
		});
	});
});

describe("env helpers", () => {
	it("mergeEnvVars: later sources override earlier ones, dropping comments and blanks", () => {
		const merged = mergeEnvVars("A=1\nB=base\n# comment\n", "B=override\n\nC=3", null, undefined);
		expect(merged).toBe("A=1\nB=override\nC=3");
	});

	it("composeEnvMap strips surrounding matching quotes only", () => {
		expect(composeEnvMap(`A="quoted"\nB='single'\nC=plain value\nD="unbalanced\nE=`)).toEqual({
			A: "quoted",
			B: "single",
			C: "plain value",
			D: '"unbalanced',
			E: "",
		});
	});

	it("shouldRedactEnvValue skips short, numeric and boolean tokens", () => {
		expect(shouldRedactEnvValue("1")).toBe(false);
		expect(shouldRedactEnvValue("postgres")).toBe(true);
		expect(shouldRedactEnvValue("30000000")).toBe(false);
		expect(shouldRedactEnvValue("false")).toBe(false);
		expect(shouldRedactEnvValue("s3cr3t-pass")).toBe(true);
		expect(shouldRedactEnvValue("   ")).toBe(false);
	});
});

describe("compose container hardening", () => {
	const spec = (yaml: string) => parseComposeFile(yaml);

	it("drops every capability and injects the minimal add-set, logging, pids and ulimits", () => {
		const out = applyComposeHardening(spec("services:\n  web:\n    image: nginx:alpine\n"));
		const web = out.services?.web as Record<string, unknown>;
		expect(web.cap_drop).toEqual(["ALL"]);
		expect(web.cap_add).toEqual([
			"CHOWN",
			"DAC_OVERRIDE",
			"FOWNER",
			"KILL",
			"NET_BIND_SERVICE",
			"SETGID",
			"SETUID",
		]);
		expect(web.security_opt).toEqual(["no-new-privileges:true"]);
		expect(web.pids_limit).toBe(1024);
		expect(web.ulimits).toEqual({ nofile: { soft: 65536, hard: 65536 } });
		expect(web.logging).toEqual({
			driver: "json-file",
			options: { "max-size": "10m", "max-file": "3" },
		});
	});

	it("merges an allowed cap_add on top of the baseline and keeps the file's own limits", () => {
		const out = applyComposeHardening(
			spec(
				"services:\n  web:\n    image: nginx:alpine\n    cap_add: [SYS_CHROOT]\n    pids_limit: 2048\n",
			),
		);
		const web = out.services?.web as Record<string, unknown>;
		expect(web.cap_add).toContain("SYS_CHROOT");
		expect(web.cap_add).toContain("CHOWN");
		expect(web.cap_drop).toEqual(["ALL"]);
		expect(web.pids_limit).toBe(2048);
	});

	it("leaves swarm-ignored keys out of stack files", () => {
		// `docker stack deploy` warns and drops security_opt/pids_limit/ulimits.
		const out = applyComposeHardening(
			spec("services:\n  web:\n    image: nginx:alpine\n"),
			"stack",
		);
		const web = out.services?.web as Record<string, unknown>;
		expect(web.cap_drop).toEqual(["ALL"]);
		expect(web.logging).toBeDefined();
		expect(web.security_opt).toBeUndefined();
		expect(web.pids_limit).toBeUndefined();
		expect(web.ulimits).toBeUndefined();
	});
});

describe("assertSafeComposeSpec — resource / scheduling escapes", () => {
	const check = (yaml: string) => () => assertSafeComposeSpec(parseComposeFile(yaml));

	it("rejects cgroup_parent", () => {
		expect(check("services:\n  x:\n    image: a\n    cgroup_parent: /docker\n")).toThrow(
			/cgroup_parent/,
		);
	});

	it("requires a bounded size= on every tmpfs", () => {
		expect(check("services:\n  x:\n    image: a\n    tmpfs: /run\n")).toThrow(/explicit size=/);
		expect(check('services:\n  x:\n    image: a\n    tmpfs: ["/run:size=4g"]\n')).toThrow(
			/larger than 1g/,
		);
		expect(check('services:\n  x:\n    image: a\n    tmpfs: ["/run:size=64m"]\n')).not.toThrow();
	});

	it("rejects log drivers that ship output off the host", () => {
		expect(check("services:\n  x:\n    image: a\n    logging:\n      driver: gelf\n")).toThrow(
			/logging driver/,
		);
		expect(
			check("services:\n  x:\n    image: a\n    logging:\n      driver: json-file\n"),
		).not.toThrow();
	});

	it("bounds pids_limit and the nofile ulimit", () => {
		expect(check("services:\n  x:\n    image: a\n    pids_limit: 99999\n")).toThrow(/pids_limit/);
		expect(
			check(
				"services:\n  x:\n    image: a\n    ulimits:\n      nofile:\n        soft: 2000000\n        hard: 2000000\n",
			),
		).toThrow(/nofile/);
	});

	it("rejects global mode and manager-node placement", () => {
		expect(check("services:\n  x:\n    image: a\n    deploy:\n      mode: global\n")).toThrow(
			/deploy.mode: global/,
		);
		expect(
			check(
				'services:\n  x:\n    image: a\n    deploy:\n      placement:\n        constraints: ["node.role == manager"]\n',
			),
		).toThrow(/manager nodes/);
	});
});

describe("injectNetwork — environment overlay", () => {
	it("joins every service to the environment overlay under a qualified alias", () => {
		const out = injectNetwork(
			parseComposeFile("services:\n  web:\n    image: a\n  db:\n    image: b\n"),
			{
				appName: "shop",
				composeType: "docker-compose",
				exposedServices: ["web"],
				environmentNetwork: "production-abc12345-net",
			},
		);
		expect(out.networks?.["production-abc12345-net"]).toEqual({
			external: true,
			name: "production-abc12345-net",
		});
		expect(out.services?.web?.networks).toEqual({
			"shop-net": {},
			"production-abc12345-net": { aliases: ["shop-web"] },
			"nixploy-network": { aliases: ["shop-web"] },
		});
		// An unexposed service stays off the shared, Traefik-facing overlay.
		expect(out.services?.db?.networks).toEqual({
			"shop-net": {},
			"production-abc12345-net": { aliases: ["shop-db"] },
		});
	});

	it("omits the environment overlay when no name is given", () => {
		const out = injectNetwork(parseComposeFile("services:\n  web:\n    image: a\n"), {
			appName: "shop",
			composeType: "docker-compose",
		});
		expect(out.services?.web?.networks).toEqual({ "shop-net": {} });
	});
});
