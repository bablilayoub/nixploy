import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ensureTraefikSetup` runs on every panel boot AND when the Let's Encrypt
 * email is saved in Settings. Traefik reads `traefik.yml` once at start, so
 * a changed email must restart the proxy — but an unchanged file (every
 * normal boot) must never touch the running service.
 */

const { state, execAsync, writeFileOnServer, readFile } = vi.hoisted(() => ({
	state: {
		email: null as string | null,
		acmeDnsProvider: null as string | null,
		/** Current traefik.yml on disk; null = missing. */
		existingStatic: null as string | null,
		serviceExists: true,
		commands: [] as string[],
	},
	execAsync: vi.fn(),
	writeFileOnServer: vi.fn(async () => {}),
	readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile }));
vi.mock("../../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				limit: async () => [
					{ letsEncryptEmail: state.email, acmeDnsProvider: state.acmeDnsProvider },
				],
			}),
		}),
	},
}));
vi.mock("../../utils/exec", () => ({ execAsync, execAsyncRemote: vi.fn() }));
vi.mock("./config-writer", () => ({ writeFileOnServer }));
vi.mock("./dashboard", () => ({
	buildDefaultTlsYaml: () => "tls: {}\n",
	DEFAULT_TLS_CONFIG_FILE: "00-default-tls.yml",
	getDashboardDomain: async () => null,
	writeDashboardRouterConfig: vi.fn(async () => {}),
}));

import { buildTraefikStaticConfig, ensureTraefikSetup, TRAEFIK_SERVICE_NAME } from "./setup";

const restarts = () =>
	state.commands.filter(
		(command) =>
			command.includes("docker service update --force") && command.includes(TRAEFIK_SERVICE_NAME),
	);
const creates = () => state.commands.filter((command) => command.includes("docker service create"));
const writtenStatic = () =>
	(writeFileOnServer.mock.calls as unknown as Array<[string, string]>)
		.filter(([filePath]) => /traefik\.yml$/.test(String(filePath)))
		.map(([, content]) => content);

describe("buildTraefikStaticConfig", () => {
	it("keeps the nixploy@localhost sentinel while no email is configured", () => {
		expect(buildTraefikStaticConfig(null)).toContain("email: nixploy@localhost");
		expect(buildTraefikStaticConfig("   ")).toContain("email: nixploy@localhost");
		expect(buildTraefikStaticConfig(" ops@example.com ")).toContain("email: ops@example.com");
	});

	it("renders no entrypoint-level HTTP → HTTPS redirect", () => {
		// The per-domain `https` toggle is implemented by a per-router
		// `redirectScheme` middleware (config-writer.ts). An entrypoint
		// redirection here would pre-empt it and make `https: false`
		// impossible to honour.
		const rendered = buildTraefikStaticConfig("ops@example.com");
		expect(rendered).not.toContain("redirections");
		expect(rendered).not.toContain("permanent: true");
		expect(rendered).toContain('  web:\n    address: ":80"\n  websecure:\n    address: ":443"');
		// ACME HTTP-01 still answers on the plain entrypoint.
		expect(rendered).toContain("httpChallenge:\n        entryPoint: web");
	});

	it("renders no DNS-01 resolver by default", () => {
		// CI diffs this exact output against docker/traefik/traefik.yml,
		// install.sh and update.sh — the default render must not move.
		const rendered = buildTraefikStaticConfig(null);
		expect(rendered).not.toContain("letsencrypt-dns");
		expect(rendered).not.toContain("dnsChallenge");
		expect(buildTraefikStaticConfig(null, null)).toBe(rendered);
		// An unknown provider code is ignored rather than written into the YAML.
		expect(buildTraefikStaticConfig(null, { provider: "; rm -rf /" })).toBe(rendered);
	});

	it("adds a letsencrypt-dns resolver when a DNS provider is configured", () => {
		const rendered = buildTraefikStaticConfig("ops@example.com", { provider: "cloudflare" });
		expect(rendered).toContain("letsencrypt-dns:");
		expect(rendered).toContain("dnsChallenge:");
		expect(rendered).toContain("provider: cloudflare");
		// Both resolvers share acme.json (keyed by resolver name) — no new mount.
		expect(rendered.match(/storage: /g)).toHaveLength(2);
		// The HTTP-01 resolver is untouched.
		expect(rendered).toContain("httpChallenge:");
	});
});

describe("ensureTraefikSetup", () => {
	beforeEach(() => {
		state.commands.length = 0;
		state.email = null;
		state.acmeDnsProvider = null;
		state.existingStatic = null;
		state.serviceExists = true;
		writeFileOnServer.mockClear();
		readFile.mockImplementation(async () => {
			if (state.existingStatic === null) throw new Error("ENOENT");
			return state.existingStatic;
		});
		execAsync.mockImplementation(async (command: string) => {
			state.commands.push(command);
			if (command.includes("docker service ls")) {
				return state.serviceExists ? `${TRAEFIK_SERVICE_NAME}\n` : "";
			}
			return "";
		});
	});

	it("leaves a running proxy alone when traefik.yml is unchanged (normal boot)", async () => {
		state.existingStatic = buildTraefikStaticConfig(null);
		await ensureTraefikSetup();
		expect(writtenStatic()).toEqual([buildTraefikStaticConfig(null)]);
		expect(restarts()).toEqual([]);
		expect(creates()).toEqual([]);
	});

	it("restarts the proxy when the ACME email changed", async () => {
		state.existingStatic = buildTraefikStaticConfig(null);
		state.email = "ops@example.com";
		await ensureTraefikSetup();
		expect(writtenStatic()).toEqual([buildTraefikStaticConfig("ops@example.com")]);
		expect(restarts()).toHaveLength(1);
		expect(creates()).toEqual([]);
	});

	it("restarts the proxy when a DNS-01 provider is configured", async () => {
		state.existingStatic = buildTraefikStaticConfig(null);
		state.acmeDnsProvider = "cloudflare";
		await ensureTraefikSetup();
		expect(writtenStatic()).toEqual([buildTraefikStaticConfig(null, { provider: "cloudflare" })]);
		expect(restarts()).toHaveLength(1);
	});

	it("creates the service on a fresh host without restarting anything", async () => {
		state.serviceExists = false;
		await ensureTraefikSetup();
		expect(creates()).toHaveLength(1);
		expect(restarts()).toEqual([]);
	});
});
