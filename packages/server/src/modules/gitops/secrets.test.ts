import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));

import type { EnvironmentGraph } from "./live";
import {
	collectSecrets,
	openSecretsBundle,
	type SecretsPayload,
	sealSecretsBundle,
	summarizeSecrets,
} from "./secrets";

const payload: SecretsPayload = {
	version: 1,
	project: { name: "shop", env: "SHARED=1" },
	environment: { name: "prod", env: null },
	applications: {
		api: {
			env: "DATABASE_URL=postgres://x\nSESSION_SECRET=abc",
			buildArgs: null,
			previewEnv: null,
		},
	},
	compose: {},
	databases: { postgres: { main: { env: "POSTGRES_INITDB_ARGS=--data-checksums" } } },
};

const PASSPHRASE = "correct horse battery staple";

describe("secrets bundle", () => {
	it("round-trips through a passphrase", () => {
		const bundle = sealSecretsBundle(payload, PASSPHRASE);
		expect(bundle.startsWith("nixploy-secrets:1:")).toBe(true);
		expect(bundle).not.toContain("SESSION_SECRET");
		expect(openSecretsBundle(bundle, PASSPHRASE)).toEqual(payload);
	});

	it("uses a fresh salt and iv per bundle", () => {
		expect(sealSecretsBundle(payload, PASSPHRASE)).not.toBe(sealSecretsBundle(payload, PASSPHRASE));
	});

	it("refuses a wrong passphrase and a tampered bundle the same way", () => {
		const bundle = sealSecretsBundle(payload, PASSPHRASE);
		expect(() => openSecretsBundle(bundle, "not the passphrase")).toThrow(/Wrong passphrase/);
		const parts = bundle.split(":");
		const data = parts[5] ?? "";
		parts[5] = `${data.slice(0, -2)}${data.endsWith("00") ? "11" : "00"}`;
		expect(() => openSecretsBundle(parts.join(":"), PASSPHRASE)).toThrow(/Wrong passphrase/);
	});

	it("refuses a short passphrase and a foreign blob", () => {
		expect(() => sealSecretsBundle(payload, "short")).toThrow();
		expect(() => openSecretsBundle("v2:aa:bb:cc", PASSPHRASE)).toThrow(/Not a Nixploy secrets/);
	});

	it("collects the redacted columns by name and counts keys, never values", () => {
		const graph = {
			project: { projectId: "p1", name: "shop", env: "SHARED=1" },
			environment: { environmentId: "e1", name: "prod", env: null },
			services: {
				applications: [
					{ name: "api", env: "A=1\nB=2", buildArgs: "NPM_TOKEN=t", previewEnv: null },
				],
				compose: [{ name: "stack", env: null, buildArgs: null, previewEnv: "X=1" }],
				postgres: [{ name: "main", env: "P=1" }],
				mysql: [],
				mariadb: [],
				mongo: [],
				redis: [],
			},
		} as unknown as EnvironmentGraph;
		const collected = collectSecrets(graph);
		expect(collected.applications.api).toEqual({
			env: "A=1\nB=2",
			buildArgs: "NPM_TOKEN=t",
			previewEnv: null,
		});
		expect(collected.compose.stack?.previewEnv).toBe("X=1");
		expect(collected.databases.postgres?.main).toEqual({ env: "P=1" });
		expect(collected.databases.redis).toEqual({});
		expect(summarizeSecrets(collected)).toEqual({ services: 3, keys: 6 });
	});
});
