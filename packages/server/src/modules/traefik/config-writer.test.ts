import { mkdtemp, readFile, rm } from "node:fs/promises";
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
	buildTraefikFileConfig,
	type TraefikDomainEntry,
	writeAppTraefikConfig,
} from "./config-writer";

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

		expect(config.http.middlewares).toBeUndefined();
		expect(config.tls).toBeUndefined();

		const router = config.http.routers["myapp-router-0"];
		expect(router).toBeDefined();
		expect(router?.rule).toBe("Host(`app.example.com`)");
		expect(router?.entryPoints).toEqual(["web"]);
		expect(router?.service).toBe("myapp-service-0");
		expect(router?.tls).toBeUndefined();

		// The platform redirects :80→:443 globally, so https-off domains get a
		// websecure router that serves the self-signed default certificate.
		const secureRouter = config.http.routers["myapp-router-websecure-0"];
		expect(secureRouter?.entryPoints).toEqual(["websecure"]);
		expect(secureRouter?.tls).toEqual({});

		const service = config.http.services["myapp-service-0"];
		expect(service?.loadBalancer.servers).toEqual([{ url: "http://myapp:3000" }]);
		expect(service?.loadBalancer.passHostHeader).toBe(true);
	});

	it("https + letsencrypt: redirect on web, certResolver on websecure", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, https: true, certificateType: "letsencrypt" }],
		});

		// Plain-HTTP router only bounces to https.
		const webRouter = config.http.routers["myapp-router-0"];
		expect(webRouter?.entryPoints).toEqual(["web"]);
		expect(webRouter?.middlewares).toEqual(["myapp-redirect-to-https"]);
		expect(webRouter?.tls).toBeUndefined();

		const secureRouter = config.http.routers["myapp-router-websecure-0"];
		expect(secureRouter?.entryPoints).toEqual(["websecure"]);
		expect(secureRouter?.tls).toEqual({ certResolver: "letsencrypt" });

		expect(config.http.middlewares?.["myapp-redirect-to-https"]).toEqual({
			redirectScheme: { scheme: "https", permanent: true },
		});
	});

	it("https + certificateType none: websecure router still declares tls (default cert)", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, https: true, certificateType: "none" }],
		});

		const webRouter = config.http.routers["myapp-router-0"];
		expect(webRouter?.middlewares).toEqual(["myapp-redirect-to-https"]);
		expect(webRouter?.tls).toBeUndefined();

		// Regression: without `tls` Traefik treats the router as plain-HTTP on
		// :443 and the TLS catch-all dashboard router answers with a 502.
		const secureRouter = config.http.routers["myapp-router-websecure-0"];
		expect(secureRouter?.entryPoints).toEqual(["websecure"]);
		expect(secureRouter?.tls).toEqual({});
		expect(config.tls).toBeUndefined();
	});

	it("adds PathPrefix to the rule for path-scoped domains", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, path: "/api" }],
		});
		expect(config.http.routers["myapp-router-0"]?.rule).toBe(
			"Host(`app.example.com`) && PathPrefix(`/api`)",
		);
	});

	it("ignores the root path", async () => {
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, path: "/" }],
		});
		expect(config.http.routers["myapp-router-0"]?.rule).toBe("Host(`app.example.com`)");
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

		expect(config.http.middlewares?.["redirect-myapp-0"]).toEqual({
			redirectRegex: {
				regex: "^http://old.example.com/(.*)",
				replacement: "http://app.example.com/$1",
				permanent: true,
			},
		});
		expect(config.http.routers["myapp-router-0"]?.middlewares).toContain("redirect-myapp-0");
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

		expect(config.http.middlewares?.["auth-myapp"]).toEqual({
			basicAuth: {
				removeHeader: true,
				users: ["admin:$2y$05$hashone", "ops:$2y$05$hashtwo"],
			},
		});
		expect(config.http.routers["myapp-router-0"]?.middlewares).toContain("auth-myapp");
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
		expect(config.http.routers["myapp-router-websecure-0"]?.tls).toEqual({});
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
		expect(config.http.services["mystack-service-0"]?.loadBalancer.servers).toEqual([
			{ url: "http://mystack-web-1:3000" },
		]);
	});

	it("produces YAML Traefik's file provider can parse", async () => {
		const { stringify } = await import("yaml");
		const config = await buildTraefikFileConfig({
			appName: "myapp",
			domains: [{ ...baseDomain, https: true, certificateType: "letsencrypt" }],
		});
		const roundTripped = parseYaml(stringify(config)) as typeof config;
		expect(roundTripped.http.routers["myapp-router-websecure-0"]?.tls).toEqual({
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

	it("removes the config file when the app has no domains", async () => {
		await writeAppTraefikConfig({ appName: "myapp", domains: [baseDomain] });
		await writeAppTraefikConfig({ appName: "myapp", domains: [] });
		await expect(readFile(`${configDir}/traefik/dynamic/myapp.yml`, "utf8")).rejects.toThrow();
	});

	it("removing a config that does not exist is a no-op", async () => {
		await expect(writeAppTraefikConfig({ appName: "ghost", domains: [] })).resolves.toBeUndefined();
	});
});
