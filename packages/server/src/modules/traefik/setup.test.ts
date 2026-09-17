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
		acmeDnsCredentials: null as Record<string, string> | null,
		/** Env the running proxy already has, as `KEY=VALUE` lines. */
		serviceEnv: [] as string[],
		/** Current traefik.yml on disk; null = missing. */
		existingStatic: null as string | null,
		serviceExists: true,
		commands: [] as string[],
		/** `traefik_entrypoint` rows the setup renders into the static config. */
		entrypoints: [] as Array<{ name: string; port: number; protocol: "tcp" | "udp" }>,
	},
	execAsync: vi.fn(),
	writeFileOnServer: vi.fn(async () => {}),
	readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ readFile }));
// Two shapes are read: the singleton settings row (`.limit(1)`) and the
// entrypoint rows (`.orderBy(...)`).
vi.mock("../../db", () => ({
	db: {
		select: () => ({
			from: () => ({
				limit: async () => [
					{
						letsEncryptEmail: state.email,
						acmeDnsProvider: state.acmeDnsProvider,
						acmeDnsCredentials: state.acmeDnsCredentials,
					},
				],
				orderBy: async () => state.entrypoints,
			}),
		}),
	},
}));
vi.mock("../../utils/exec", () => ({ execAsync, execAsyncRemote: vi.fn() }));
vi.mock("./config-writer", () => ({
	writeFileOnServer,
	assertEntrypointName: (name: string) => name,
}));
vi.mock("./dashboard", () => ({
	buildDefaultTlsYaml: () => "tls: {}\n",
	DEFAULT_TLS_CONFIG_FILE: "00-default-tls.yml",
	getDashboardDomain: async () => null,
	writeDashboardRouterConfig: vi.fn(async () => {}),
}));

import {
	buildAcmeDnsEnv,
	buildAcmeDnsEnvUpdate,
	buildTraefikStaticConfig,
	ensureTraefikSetup,
	TRAEFIK_SERVICE_NAME,
} from "./setup";

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
		state.acmeDnsCredentials = null;
		state.serviceEnv.length = 0;
		state.existingStatic = null;
		state.serviceExists = true;
		state.entrypoints.length = 0;
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
			if (command.includes("docker service inspect")) {
				return state.serviceEnv.join("\n");
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

describe("buildAcmeDnsEnv", () => {
	it("emits only the variables the selected provider declares", () => {
		expect(
			buildAcmeDnsEnv("cloudflare", {
				CF_DNS_API_TOKEN: "tok",
				// An operator-supplied blob is not a free hand on Traefik's
				// environment: anything the provider did not declare is dropped.
				TRAEFIK_ANYTHING: "nope",
				AWS_SECRET_ACCESS_KEY: "other-provider",
			}),
		).toEqual([{ key: "CF_DNS_API_TOKEN", value: "tok" }]);
	});

	it("treats a blank value as not configured", () => {
		expect(buildAcmeDnsEnv("cloudflare", { CF_DNS_API_TOKEN: "   " })).toEqual([]);
	});

	it("emits nothing without a provider, an unknown provider or no credentials", () => {
		expect(buildAcmeDnsEnv(null, { CF_DNS_API_TOKEN: "tok" })).toEqual([]);
		expect(buildAcmeDnsEnv("not-a-provider", { CF_DNS_API_TOKEN: "tok" })).toEqual([]);
		expect(buildAcmeDnsEnv("cloudflare", null)).toEqual([]);
	});

	it("keeps every variable a multi-key provider needs", () => {
		expect(
			buildAcmeDnsEnv("route53", {
				AWS_ACCESS_KEY_ID: "id",
				AWS_SECRET_ACCESS_KEY: "secret",
				AWS_REGION: "eu-central-1",
			}).map((entry) => entry.key),
		).toEqual(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"]);
	});
});

describe("buildAcmeDnsEnvUpdate", () => {
	it("does nothing when the proxy already has exactly these values", () => {
		// The whole point of the diff: --env-add recreates the proxy task, and
		// that is a ~9 s outage for every routed domain.
		expect(
			buildAcmeDnsEnvUpdate(
				["CF_DNS_API_TOKEN=tok", "TZ=UTC"],
				[{ key: "CF_DNS_API_TOKEN", value: "tok" }],
			),
		).toEqual([]);
	});

	it("adds a new variable and updates a rotated one", () => {
		expect(buildAcmeDnsEnvUpdate([], [{ key: "CF_DNS_API_TOKEN", value: "tok" }])).toEqual([
			"--env-add 'CF_DNS_API_TOKEN=tok'",
		]);
		expect(
			buildAcmeDnsEnvUpdate(["CF_DNS_API_TOKEN=old"], [{ key: "CF_DNS_API_TOKEN", value: "new" }]),
		).toEqual(["--env-add 'CF_DNS_API_TOKEN=new'"]);
	});

	it("removes the keys a previous provider set when switching", () => {
		expect(
			buildAcmeDnsEnvUpdate(
				["CF_DNS_API_TOKEN=tok"],
				[
					{ key: "AWS_ACCESS_KEY_ID", value: "id" },
					{ key: "AWS_SECRET_ACCESS_KEY", value: "secret" },
				],
			),
		).toEqual([
			"--env-rm 'CF_DNS_API_TOKEN'",
			"--env-add 'AWS_ACCESS_KEY_ID=id'",
			"--env-add 'AWS_SECRET_ACCESS_KEY=secret'",
		]);
	});

	it("never removes an env var this feature does not own", () => {
		// An operator who added their own variable to the proxy keeps it.
		expect(buildAcmeDnsEnvUpdate(["TZ=UTC", "HTTP_PROXY=x"], [])).toEqual([]);
	});

	it("clears the credentials when the provider is switched off", () => {
		expect(buildAcmeDnsEnvUpdate(["CF_DNS_API_TOKEN=tok"], [])).toEqual([
			"--env-rm 'CF_DNS_API_TOKEN'",
		]);
	});
});

describe("ensureTraefikSetup — DNS-01 credentials", () => {
	const envUpdates = () =>
		state.commands.filter((command) => command.includes("docker service update --detach --env"));

	beforeEach(() => {
		state.commands.length = 0;
		state.email = null;
		state.acmeDnsProvider = "cloudflare";
		state.acmeDnsCredentials = { CF_DNS_API_TOKEN: "tok" };
		state.serviceEnv.length = 0;
		state.existingStatic = null;
		state.serviceExists = true;
		state.entrypoints.length = 0;
		writeFileOnServer.mockClear();
	});

	it("passes the credentials when it creates the proxy", async () => {
		state.serviceExists = false;
		await ensureTraefikSetup();
		expect(creates()[0]).toContain("--env 'CF_DNS_API_TOKEN=tok'");
	});

	it("pushes a rotated token onto the running proxy", async () => {
		state.existingStatic = buildTraefikStaticConfig(null, { provider: "cloudflare" });
		state.serviceEnv.push("CF_DNS_API_TOKEN=old");
		await ensureTraefikSetup();
		expect(envUpdates()).toHaveLength(1);
		expect(envUpdates()[0]).toContain("--env-add 'CF_DNS_API_TOKEN=tok'");
	});

	it("leaves the proxy alone when the credentials already match", async () => {
		state.existingStatic = buildTraefikStaticConfig(null, { provider: "cloudflare" });
		state.serviceEnv.push("CF_DNS_API_TOKEN=tok");
		await ensureTraefikSetup();
		expect(envUpdates()).toEqual([]);
		expect(restarts()).toEqual([]);
	});

	it("does not also force a restart — --env-add already recreated the task", async () => {
		// The static config changed AND the credentials changed. One task
		// recreation is enough; a second would be another ~9 s of downtime.
		state.existingStatic = "stale: true\n";
		state.serviceEnv.push("CF_DNS_API_TOKEN=old");
		await ensureTraefikSetup();
		expect(envUpdates()).toHaveLength(1);
		expect(restarts()).toEqual([]);
	});
});
