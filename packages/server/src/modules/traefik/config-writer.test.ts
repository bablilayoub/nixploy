import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

// The custom-certificate path reads certificate rows from the DB — mock the
// lazy client so no live database is needed.
const { certRows } = vi.hoisted(() => ({
	certRows: {
		value: [] as Array<{ certificateId: string; certificatePath: string }>,
	},
}));
vi.mock("../../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => Promise.resolve(certRows.value),
			}),
		}),
	},
}));

import {
	assertSafeRedirectReplacement,
	buildTraefikFileConfig,
	type TraefikDomainEntry,
	toTraefikDomainEntry,
	writeAppTraefikConfig,
	writeLocalFileAtomic,
} from "./config-writer";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const baseDomain: TraefikDomainEntry = {
	host: "app.example.com",
	port: 3000,
	https: false,
	certificateType: "none",
};

describe("buildTraefikFileConfig", () => {
	it("single http domain: web router + default-cert websecure router", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [baseDomain],
		});

		expect(config.http?.middlewares).toBeUndefined();
		expect(config.tls).toBeUndefined();

		const router = config.http?.routers["myapp-router-0"];
		expect(router).toBeDefined();
		expect(router?.rule).toBe("Host(`app.example.com`)");
		expect(router?.entryPoints).toEqual(["web"]);
		expect(router?.service).toBe("myapp-service-0");
		expect(router?.tls).toBeUndefined();

		// The platform redirects :80→:443 globally, so https-off domains get a
		// websecure router that serves the self-signed default certificate.
		const secureRouter = config.http?.routers["myapp-router-websecure-0"];
		expect(secureRouter?.entryPoints).toEqual(["websecure"]);
		expect(secureRouter?.tls).toEqual({});

		const service = config.http?.services["myapp-service-0"];
		expect(service?.loadBalancer.servers).toEqual([{ url: "http://myapp:3000" }]);
		expect(service?.loadBalancer.passHostHeader).toBe(true);
	});

	it("https + letsencrypt: redirect on web, certResolver on websecure", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, https: true, certificateType: "letsencrypt" }],
		});

		// Plain-HTTP router only bounces to https.
		const webRouter = config.http?.routers["myapp-router-0"];
		expect(webRouter?.entryPoints).toEqual(["web"]);
		expect(webRouter?.middlewares).toEqual(["myapp-redirect-to-https"]);
		expect(webRouter?.tls).toBeUndefined();

		const secureRouter = config.http?.routers["myapp-router-websecure-0"];
		expect(secureRouter?.entryPoints).toEqual(["websecure"]);
		expect(secureRouter?.tls).toEqual({ certResolver: "letsencrypt" });

		expect(config.http?.middlewares?.["myapp-redirect-to-https"]).toEqual({
			redirectScheme: { scheme: "https", permanent: true },
		});
	});

	it("https + certificateType none: websecure router still declares tls (default cert)", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, https: true, certificateType: "none" }],
		});

		const webRouter = config.http?.routers["myapp-router-0"];
		expect(webRouter?.middlewares).toEqual(["myapp-redirect-to-https"]);
		expect(webRouter?.tls).toBeUndefined();

		// Regression: without `tls` Traefik treats the router as plain-HTTP on
		// :443 and the TLS catch-all dashboard router answers with a 502.
		const secureRouter = config.http?.routers["myapp-router-websecure-0"];
		expect(secureRouter?.entryPoints).toEqual(["websecure"]);
		expect(secureRouter?.tls).toEqual({});
		expect(config.tls).toBeUndefined();
	});

	it("adds PathPrefix to the rule for path-scoped domains", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, path: "/api" }],
		});
		expect(config.http?.routers["myapp-router-0"]?.rule).toBe(
			"Host(`app.example.com`) && PathPrefix(`/api`)",
		);
	});

	it("ignores the root path", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, path: "/" }],
		});
		expect(config.http?.routers["myapp-router-0"]?.rule).toBe("Host(`app.example.com`)");
	});

	it("redirect entries become redirectRegex middlewares referenced by routers", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [baseDomain],
			redirects: [
				{
					regex: "^http://old.example.com/(.*)",
					replacement: "http://app.example.com/$1",
					permanent: true,
				},
			],
		});

		expect(config.http?.middlewares?.["redirect-myapp-0"]).toEqual({
			redirectRegex: {
				regex: "^http://old.example.com/(.*)",
				replacement: "http://app.example.com/$1",
				permanent: true,
			},
		});
		expect(config.http?.routers["myapp-router-0"]?.middlewares).toContain("redirect-myapp-0");
	});

	it("basic-auth entries become a single basicAuth middleware", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [baseDomain],
			basicAuth: [
				{ username: "admin", password: "$2y$05$hashone" },
				{ username: "ops", password: "$2y$05$hashtwo" },
			],
		});

		expect(config.http?.middlewares?.["auth-myapp"]).toEqual({
			basicAuth: {
				removeHeader: true,
				users: ["admin:$2y$05$hashone", "ops:$2y$05$hashtwo"],
			},
		});
		expect(config.http?.routers["myapp-router-0"]?.middlewares).toContain("auth-myapp");
	});

	it("inlines custom certificates from the DB into tls.certificates", async () => {
		certRows.value = [
			{
				certificateId: "cert-1",
				certificatePath: "/etc/nixploy/traefik/dynamic/certificates/cert-1.crt",
			},
		];
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [
				{
					...baseDomain,
					https: true,
					certificateType: "custom",
					certificateId: "cert-1",
				},
			],
		});

		// TLS enabled without a resolver — the cert comes from tls.certificates.
		expect(config.http?.routers["myapp-router-websecure-0"]?.tls).toEqual({});
		expect(config.tls?.certificates).toEqual([
			{
				certFile: "/etc/nixploy/traefik/dynamic/certificates/cert-1.crt",
				keyFile: "/etc/nixploy/traefik/dynamic/certificates/cert-1.key",
			},
		]);
		certRows.value = [];
	});

	it("routes compose domains to <appName>-<serviceName>-1", async () => {
		const config = await buildTraefikFileConfig({
			appName: "mystack",
			domains: [{ ...baseDomain, serviceName: "web" }],
		});
		expect(config.http?.services["mystack-service-0"]?.loadBalancer.servers).toEqual([
			{ url: "http://mystack-web-1:3000" },
		]);
	});

	it("rewrites the public path prefix to the internal one (strip, then add)", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, path: "/public", internalPath: "/internal" }],
		});
		expect(config.http?.middlewares?.["strip-myapp-0"]).toEqual({
			stripPrefix: { prefixes: ["/public"] },
		});
		expect(config.http?.middlewares?.["addprefix-myapp-0"]).toEqual({
			addPrefix: { prefix: "/internal" },
		});
		// addPrefix alone would send /internal/public/*; strip runs first.
		expect(config.http?.routers["myapp-router-0"]?.middlewares).toEqual([
			"strip-myapp-0",
			"addprefix-myapp-0",
		]);
	});

	it("only adds the internal prefix when the public path is the root", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, path: "/", internalPath: "/internal" }],
		});
		expect(config.http?.middlewares?.["strip-myapp-0"]).toBeUndefined();
		expect(config.http?.routers["myapp-router-0"]?.middlewares).toEqual(["addprefix-myapp-0"]);
	});

	it("chains per-domain middlewares after the shared ones, in order", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [
				{
					...baseDomain,
					middlewares: [
						{ kind: "compress", config: {}, order: 2 },
						{ kind: "rateLimit", config: { average: 2, burst: 2 }, order: 0 },
						{ kind: "ipAllowList", config: { sourceRange: ["127.0.0.1/32"] }, order: 1 },
						{ kind: "headers", config: { stsSeconds: 60 }, order: 3, enabled: false },
					],
				},
			],
			basicAuth: [{ username: "admin", password: "$2y$05$hash" }],
		});

		// Shared basic-auth first, then the enabled rows by `order`; the
		// disabled one is not rendered at all.
		expect(config.http?.routers["myapp-router-0"]?.middlewares).toEqual([
			"auth-myapp",
			"mw-myapp-0-0-rateLimit",
			"mw-myapp-0-1-ipAllowList",
			"mw-myapp-0-2-compress",
		]);
		expect(config.http?.middlewares?.["mw-myapp-0-0-rateLimit"]).toEqual({
			rateLimit: { average: 2, burst: 2 },
		});
		expect(config.http?.middlewares?.["mw-myapp-0-3-headers"]).toBeUndefined();
	});

	it("stickyCookie configures the load balancer, not a middleware", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [
				{
					...baseDomain,
					middlewares: [{ kind: "stickyCookie", config: { name: "sess", secure: true } }],
				},
			],
		});
		expect(config.http?.services["myapp-service-0"]?.loadBalancer.sticky).toEqual({
			cookie: { name: "sess", secure: true, httpOnly: true },
		});
		expect(config.http?.routers["myapp-router-0"]?.middlewares).toEqual([]);
	});

	it("maintenance serves the panel's page for every backend response", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, middlewares: [{ kind: "maintenance", config: {} }] }],
		});
		expect(config.http?.middlewares?.["mw-myapp-0-0-maintenance"]).toEqual({
			errors: { status: ["100-599"], service: "nixploy-dashboard", query: "/__maintenance" },
		});
	});

	it("rejects a middleware config that no longer validates", async () => {
		await expect(
			buildTraefikFileConfig({
				appName: "myapp",
				domains: [
					{ ...baseDomain, middlewares: [{ kind: "ipAllowList", config: { sourceRange: ["x"] } }] },
				],
			}),
		).rejects.toThrow(/CIDR/);
	});

	it("wildcard hosts become a single-label HostRegexp with a DNS-01 resolver", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [
				{ ...baseDomain, host: "*.apps.example.com", https: true, certificateType: "letsencrypt" },
			],
		});
		expect(config.http?.routers["myapp-router-websecure-0"]?.rule).toBe(
			"HostRegexp(`^[a-zA-Z0-9_-]+\\.apps\\.example\\.com$`)",
		);
		expect(config.http?.routers["myapp-router-websecure-0"]?.tls).toEqual({
			certResolver: "letsencrypt-dns",
			domains: [{ main: "*.apps.example.com" }],
		});
	});

	it("still rejects inner wildcards and bare-TLD wildcards", async () => {
		await expect(
			buildTraefikFileConfig({ appName: "myapp", domains: [{ ...baseDomain, host: "*.com" }] }),
		).rejects.toThrow(/parent domain/);
		await expect(
			buildTraefikFileConfig({
				appName: "myapp",
				domains: [{ ...baseDomain, host: "ap*p.example.com" }],
			}),
		).rejects.toThrow(/Invalid Traefik host/);
	});

	it("produces YAML Traefik's file provider can parse", async () => {
		const { stringify } = await import("yaml");
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, https: true, certificateType: "letsencrypt" }],
		});
		const roundTripped = parseYaml(stringify(config)) as typeof config;
		expect(roundTripped.http?.routers["myapp-router-websecure-0"]?.tls).toEqual({
			certResolver: "letsencrypt",
		});
	});
});

describe("writeAppTraefikConfig", () => {
	let configDir: string;
	let originalConfigDir: string | undefined;

	beforeEach(async () => {
		configDir = await mkdtemp(join(tmpdir(), "nixploy-traefik-test-"));
		originalConfigDir = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = configDir;
	});

	afterEach(async () => {
		if (originalConfigDir === undefined) {
			delete process.env.NIXPLOY_CONFIG_DIR;
		} else {
			process.env.NIXPLOY_CONFIG_DIR = originalConfigDir;
		}
		await rm(configDir, { recursive: true, force: true });
	});

	it("writes <dynamic>/<appName>.yml for an app with domains", async () => {
		await writeAppTraefikConfig({ appName: "myapp", domains: [baseDomain] });
		const content = await readFile(`${configDir}/traefik/dynamic/myapp.yml`, "utf8");
		const parsed = parseYaml(content) as {
			http: { routers: Record<string, { rule: string }> };
		};
		expect(parsed.http.routers["myapp-router-0"]?.rule).toBe("Host(`app.example.com`)");
	});

	it("always writes on the Nixploy host, even for apps pinned to a managed server", async () => {
		// nixploy-traefik runs on the primary; a YAML pushed over SSH onto the
		// app's server is a file nothing reads. (The mocked db has no server
		// lookup, so any SSH attempt here would throw.)
		await writeAppTraefikConfig({
			appName: "remote-app",
			serverId: "srv-1",
			domains: [baseDomain],
		});
		const content = await readFile(`${configDir}/traefik/dynamic/remote-app.yml`, "utf8");
		expect(content).toContain("Host(`app.example.com`)");
		await writeAppTraefikConfig({ appName: "remote-app", serverId: "srv-1", domains: [] });
		await expect(readFile(`${configDir}/traefik/dynamic/remote-app.yml`, "utf8")).rejects.toThrow();
	});

	it("removes the config file when the app has no domains", async () => {
		await writeAppTraefikConfig({ appName: "myapp", domains: [baseDomain] });
		await writeAppTraefikConfig({ appName: "myapp", domains: [] });
		await expect(readFile(`${configDir}/traefik/dynamic/myapp.yml`, "utf8")).rejects.toThrow();
	});

	it("removing a config that does not exist is a no-op", async () => {
		await expect(writeAppTraefikConfig({ appName: "ghost", domains: [] })).resolves.toBeUndefined();
	});

	it("skips the write when the rendered YAML is unchanged and rewrites when it changes", async () => {
		const file = `${configDir}/traefik/dynamic/myapp.yml`;
		await writeAppTraefikConfig({ appName: "myapp", domains: [baseDomain] });
		const first = await stat(file);
		await sleep(30);

		// Same input → identical YAML → the file is left untouched (no reload).
		await writeAppTraefikConfig({ appName: "myapp", domains: [baseDomain] });
		expect((await stat(file)).mtimeMs).toBe(first.mtimeMs);

		await writeAppTraefikConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, host: "new.example.com" }],
		});
		expect((await stat(file)).mtimeMs).not.toBe(first.mtimeMs);
		expect(await readFile(file, "utf8")).toContain("new.example.com");
		// No temp files linger in the watched directory.
		expect(await readdir(`${configDir}/traefik/dynamic`)).toEqual(["myapp.yml"]);
	});
});

describe("writeLocalFileAtomic", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nixploy-atomic-test-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("creates parent directories, writes once, then reports unchanged content", async () => {
		const file = join(dir, "nested", "app.yml");
		expect(await writeLocalFileAtomic(file, "a: 1\n")).toBe("written");
		expect(await writeLocalFileAtomic(file, "a: 1\n")).toBe("unchanged");
		expect(await writeLocalFileAtomic(file, "a: 2\n")).toBe("written");
		expect(await readFile(file, "utf8")).toBe("a: 2\n");
		expect(await readdir(join(dir, "nested"))).toEqual(["app.yml"]);
	});

	it("never leaves a partial file behind when the temp write fails", async () => {
		const file = join(dir, "app.yml");
		await writeLocalFileAtomic(file, "keep\n");
		// A directory at the temp path's parent cannot be created because
		// `file` itself is the parent → writeFile fails, the original stays.
		const bad = join(file, "child.yml");
		await expect(writeLocalFileAtomic(bad, "x")).rejects.toThrow();
		expect(await readFile(file, "utf8")).toBe("keep\n");
		expect(await readdir(dir)).toEqual(["app.yml"]);
	});
});

describe("assertSafeRedirectReplacement", () => {
	const own = new Set(["app.example.com"]);

	it("allows relative targets and capture groups", () => {
		// `${1}` spelled out so biome does not read it as a template placeholder.
		const braced = `$${"{1}"}/x`;
		expect(assertSafeRedirectReplacement("/moved/$1", own)).toBe("/moved/$1");
		expect(assertSafeRedirectReplacement(braced, own)).toBe(braced);
	});

	it("allows https anywhere and http only on the service's own hosts", () => {
		expect(assertSafeRedirectReplacement("https://elsewhere.example/x", own)).toBe(
			"https://elsewhere.example/x",
		);
		expect(assertSafeRedirectReplacement("http://app.example.com/$1", own)).toBe(
			"http://app.example.com/$1",
		);
	});

	it("refuses cross-host http, protocol-relative and non-http schemes", () => {
		expect(() => assertSafeRedirectReplacement("http://evil.example/x", own)).toThrow(
			/own domains/,
		);
		expect(() => assertSafeRedirectReplacement("//evil.example/x", own)).toThrow(
			/protocol-relative/,
		);
		expect(() => assertSafeRedirectReplacement("javascript://evil/x", own)).toThrow(/http\(s\)/);
	});

	it("refuses a host built from a capture group", () => {
		expect(() => assertSafeRedirectReplacement("https://$1.example/x", own)).toThrow(
			/literal host/,
		);
	});
});

describe("buildTraefikFileConfig — tcp/udp routers", () => {
	const tcpDomain: TraefikDomainEntry = {
		host: "db.example.com",
		port: 5432,
		https: false,
		certificateType: "none",
		protocol: "tcp",
		entrypoint: "pg-15432",
		tlsMode: "none",
		uniqueConfigKey: "k1",
	};

	it("plain tcp: catch-all HostSNI, no tls, host:port backend", async () => {
		const config = await buildTraefikFileConfig({ appName: "pgapp", domains: [tcpDomain] });

		// No HTTP section at all. A layer-4 row must never be published on :80,
		// and Traefik v3 rejects a whole file whose `http.routers` map is empty
		// ("routers cannot be a standalone element"), which would silently drop
		// the tcp routers too (verified against traefik:v3.5.0).
		expect(config.http).toBeUndefined();
		expect(config.udp).toBeUndefined();

		const router = config.tcp?.routers["pgapp-tcp-router-k1"];
		expect(router?.rule).toBe("HostSNI(`*`)");
		expect(router?.entryPoints).toEqual(["pg-15432"]);
		expect(router?.service).toBe("pgapp-tcp-service-k1");
		expect(router?.tls).toBeUndefined();
		expect(config.tcp?.services["pgapp-tcp-service-k1"]).toEqual({
			loadBalancer: { servers: [{ address: "pgapp:5432" }] },
		});
	});

	it("tls passthrough: HostSNI(host) + passthrough, no cert resolver", async () => {
		const config = await buildTraefikFileConfig({
			appName: "pgapp",
			domains: [{ ...tcpDomain, tlsMode: "passthrough", certificateType: "letsencrypt" }],
		});
		const router = config.tcp?.routers["pgapp-tcp-router-k1"];
		expect(router?.rule).toBe("HostSNI(`db.example.com`)");
		expect(router?.tls).toEqual({ passthrough: true });
	});

	it("tls terminate with letsencrypt uses the http-01 resolver", async () => {
		const config = await buildTraefikFileConfig({
			appName: "pgapp",
			domains: [{ ...tcpDomain, tlsMode: "terminate", certificateType: "letsencrypt" }],
		});
		expect(config.tcp?.routers["pgapp-tcp-router-k1"]?.tls).toEqual({
			certResolver: "letsencrypt",
		});
	});

	it("tls terminate on a wildcard host asks the DNS resolver for the SAN", async () => {
		const config = await buildTraefikFileConfig({
			appName: "pgapp",
			domains: [
				{
					...tcpDomain,
					host: "*.db.example.com",
					tlsMode: "terminate",
					certificateType: "letsencrypt",
				},
			],
		});
		const router = config.tcp?.routers["pgapp-tcp-router-k1"];
		expect(router?.rule).toBe("HostSNI(`*.db.example.com`)");
		expect(router?.tls).toEqual({
			certResolver: "letsencrypt-dns",
			domains: [{ main: "*.db.example.com" }],
		});
	});

	it("tls terminate with certificateType none declares an empty tls block", async () => {
		const config = await buildTraefikFileConfig({
			appName: "pgapp",
			domains: [{ ...tcpDomain, tlsMode: "terminate" }],
		});
		expect(config.tcp?.routers["pgapp-tcp-router-k1"]?.tls).toEqual({});
	});

	it("udp: no rule, no tls, its own router/service pair", async () => {
		const config = await buildTraefikFileConfig({
			appName: "dnsapp",
			domains: [
				{
					host: "dns.example.com",
					port: 53,
					https: false,
					certificateType: "none",
					protocol: "udp",
					entrypoint: "dns-1053",
					uniqueConfigKey: "u1",
				},
			],
		});
		expect(config.tcp).toBeUndefined();
		expect(config.udp?.routers["dnsapp-udp-router-u1"]).toEqual({
			service: "dnsapp-udp-service-u1",
			entryPoints: ["dns-1053"],
		});
		expect(config.udp?.services["dnsapp-udp-service-u1"]).toEqual({
			loadBalancer: { servers: [{ address: "dnsapp:53" }] },
		});
	});

	it("a compose tcp row targets <appName>-<service>-1", async () => {
		const config = await buildTraefikFileConfig({
			appName: "stack",
			domains: [{ ...tcpDomain, serviceName: "db" }],
		});
		expect(config.tcp?.services["stack-tcp-service-k1"]?.loadBalancer.servers[0]?.address).toBe(
			"stack-db-1:5432",
		);
	});

	it("http and tcp domains coexist in one file", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [baseDomain, tcpDomain],
		});
		expect(Object.keys(config.http?.routers ?? {})).toEqual([
			"myapp-router-0",
			"myapp-router-websecure-0",
		]);
		expect(Object.keys(config.tcp?.routers ?? {})).toEqual(["myapp-tcp-router-k1"]);
	});

	it("rejects a missing or unsafe entrypoint name", async () => {
		await expect(
			buildTraefikFileConfig({ appName: "a", domains: [{ ...tcpDomain, entrypoint: null }] }),
		).rejects.toThrow(/entrypoint name/i);
		await expect(
			buildTraefikFileConfig({
				appName: "a",
				domains: [{ ...tcpDomain, entrypoint: "pg\n  bad: yes" }],
			}),
		).rejects.toThrow(/entrypoint name/i);
		await expect(
			buildTraefikFileConfig({ appName: "a", domains: [{ ...tcpDomain, entrypoint: "web" }] }),
		).rejects.toThrow(/reserved/i);
	});

	it("writes tcp routers into the app's dynamic YAML", async () => {
		const configDir = await mkdtemp(join(tmpdir(), "nixploy-traefik-l4-"));
		const original = process.env.NIXPLOY_CONFIG_DIR;
		process.env.NIXPLOY_CONFIG_DIR = configDir;
		try {
			await writeAppTraefikConfig({ appName: "pgapp", domains: [tcpDomain] });
			const written = parseYaml(
				await readFile(`${configDir}/traefik/dynamic/pgapp.yml`, "utf8"),
			) as {
				tcp: {
					routers: Record<string, { rule: string; entryPoints: string[] }>;
					services: Record<string, { loadBalancer: { servers: Array<{ address: string }> } }>;
				};
			};
			expect(written.tcp.routers["pgapp-tcp-router-k1"]?.rule).toBe("HostSNI(`*`)");
			expect(written.tcp.services["pgapp-tcp-service-k1"]?.loadBalancer.servers[0]?.address).toBe(
				"pgapp:5432",
			);
		} finally {
			if (original === undefined) delete process.env.NIXPLOY_CONFIG_DIR;
			else process.env.NIXPLOY_CONFIG_DIR = original;
			await rm(configDir, { recursive: true, force: true });
		}
	});
});

describe("toTraefikDomainEntry", () => {
	it("carries every routing column, defaulting the layer-4 ones", () => {
		expect(
			toTraefikDomainEntry({
				host: "app.example.com",
				port: null,
				path: "/",
				internalPath: null,
				https: true,
				certificateType: "letsencrypt",
				certificateId: null,
			}),
		).toMatchObject({ port: 80, protocol: "http", entrypoint: null, tlsMode: "none" });

		expect(
			toTraefikDomainEntry({
				host: "db.example.com",
				port: 5432,
				path: "/",
				internalPath: null,
				https: false,
				certificateType: "none",
				certificateId: null,
				protocol: "tcp",
				entrypoint: "pg-15432",
				tlsMode: "passthrough",
			}),
		).toMatchObject({ protocol: "tcp", entrypoint: "pg-15432", tlsMode: "passthrough" });
	});
});

describe("panel forward auth (nixployAuth)", () => {
	const protectedDomain: TraefikDomainEntry = {
		...baseDomain,
		domainId: "dom_1",
		https: true,
		certificateType: "letsencrypt",
		middlewares: [{ kind: "nixployAuth", config: {}, order: 0, enabled: true }],
	};

	it("chains the verify middleware and exposes the callback past it", async () => {
		const config = await buildTraefikFileConfig({ appName: "myapp", domains: [protectedDomain] });
		const routers = config.http?.routers ?? {};
		const middlewares = config.http?.middlewares ?? {};

		const chained = routers["myapp-router-websecure-0"]?.middlewares ?? [];
		const authName = chained.find((name) => name.includes("nixployAuth"));
		expect(authName).toBeDefined();
		expect(middlewares[authName as string]).toMatchObject({
			forwardAuth: { address: expect.stringContaining("domain=dom_1") },
		});

		// The callback router must reach the panel WITHOUT the middleware it
		// exists to complete, or the exchange is a redirect loop.
		const callback = routers["myapp-appauth-0-websecure"];
		expect(callback).toBeDefined();
		expect(callback?.service).toBe("nixploy-dashboard");
		expect(callback?.middlewares).toBeUndefined();
		expect(callback?.rule).toContain("PathPrefix(`/_nixploy/`)");
		expect(callback?.priority).toBeGreaterThan(1000);
		expect(callback?.tls).toEqual({ certResolver: "letsencrypt" });
	});

	it("adds a plain-http callback router only for an https-off domain", async () => {
		const secure = await buildTraefikFileConfig({ appName: "myapp", domains: [protectedDomain] });
		expect(secure.http?.routers?.["myapp-appauth-0"]).toBeUndefined();

		const plain = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...protectedDomain, https: false, certificateType: "none" }],
		});
		expect(plain.http?.routers?.["myapp-appauth-0"]?.entryPoints).toEqual(["web"]);
	});

	it("emits no callback router for a domain nobody protected", async () => {
		const config = await buildTraefikFileConfig({ appName: "myapp", domains: [baseDomain] });
		const names = Object.keys(config.http?.routers ?? {});
		expect(names.some((name) => name.includes("appauth"))).toBe(false);
	});

	it("refuses to write the file when the row has no domain id", async () => {
		// Fail closed: a middleware that cannot name its policy would otherwise
		// render a forwardAuth the verifier answers 403 to, for every request.
		await expect(
			buildTraefikFileConfig({
				appName: "myapp",
				domains: [{ ...protectedDomain, domainId: null }],
			}),
		).rejects.toThrow(/domain it belongs to/);
	});
});
