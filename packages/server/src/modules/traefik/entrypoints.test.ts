import { describe, expect, it, vi } from "vitest";

// The module reads `traefik_entrypoint` rows lazily; nothing in this file
// touches the database, but importing it must not open a connection.
vi.mock("../../db", () => ({ db: {} }));

import {
	assertValidEntrypoint,
	buildPublishUpdateArgs,
	desiredPublishedPorts,
	type PublishedPort,
	renderEntrypointsYaml,
	type TraefikEntrypointSpec,
} from "./entrypoints";
import { buildTraefikStaticConfig } from "./setup";

const pg: TraefikEntrypointSpec = { name: "pg-15432", port: 15432, protocol: "tcp" };
const dns: TraefikEntrypointSpec = { name: "dns-1053", port: 1053, protocol: "udp" };

describe("assertValidEntrypoint", () => {
	it("accepts a lowercase slug on a safe high port", () => {
		expect(assertValidEntrypoint({ name: "PG-15432", port: 15432, protocol: "tcp" })).toEqual(pg);
	});

	it("refuses names that would break out of the YAML", () => {
		for (const name of ["pg 15432", "pg:\n  bad", "Pg_15432", "-pg", "a"]) {
			expect(() => assertValidEntrypoint({ name, port: 15432, protocol: "tcp" })).toThrow(
				/entrypoint name/i,
			);
		}
	});

	it("refuses the HTTP entrypoint names", () => {
		expect(() => assertValidEntrypoint({ name: "web", port: 15432, protocol: "tcp" })).toThrow(
			/reserved/i,
		);
		expect(() =>
			assertValidEntrypoint({ name: "websecure", port: 15432, protocol: "tcp" }),
		).toThrow(/reserved/i);
	});

	it("refuses privileged, blocked and already-served ports", () => {
		expect(() => assertValidEntrypoint({ name: "low", port: 443, protocol: "tcp" })).toThrow();
		expect(() => assertValidEntrypoint({ name: "http", port: 80, protocol: "tcp" })).toThrow();
		// 5432 is on the shared blocked-host-port list (the host's own Postgres).
		expect(() => assertValidEntrypoint({ name: "pg", port: 5432, protocol: "tcp" })).toThrow(
			/not allowed/i,
		);
	});
});

describe("renderEntrypointsYaml", () => {
	it("renders nothing without entrypoints", () => {
		expect(renderEntrypointsYaml([])).toBe("");
	});

	it("defaults to TCP and marks UDP explicitly", () => {
		expect(renderEntrypointsYaml([pg, dns])).toBe(
			'  pg-15432:\n    address: ":15432"\n  dns-1053:\n    address: ":1053/udp"\n',
		);
	});
});

describe("buildTraefikStaticConfig with entrypoints", () => {
	it("is byte-identical to the shipped file when there are none", () => {
		expect(buildTraefikStaticConfig(null, null, [])).toBe(buildTraefikStaticConfig());
	});

	it("appends the extra entrypoints after websecure", () => {
		const config = buildTraefikStaticConfig(null, null, [pg, dns]);
		expect(config).toContain(
			'  websecure:\n    address: ":443"\n  pg-15432:\n    address: ":15432"\n  dns-1053:\n    address: ":1053/udp"\nproviders:',
		);
	});
});

describe("published ports", () => {
	const builtins: PublishedPort[] = [
		{ targetPort: 80, publishedPort: 80, protocol: "tcp" },
		{ targetPort: 443, publishedPort: 443, protocol: "tcp" },
	];

	it("always keeps 80/443 and adds one host-mode mapping per entrypoint", () => {
		expect(desiredPublishedPorts([pg, dns])).toEqual([
			{ targetPort: 80, publishedPort: 80, protocol: "tcp", publishMode: "host" },
			{ targetPort: 443, publishedPort: 443, protocol: "tcp", publishMode: "host" },
			{ targetPort: 15432, publishedPort: 15432, protocol: "tcp", publishMode: "host" },
			{ targetPort: 1053, publishedPort: 1053, protocol: "udp", publishMode: "host" },
		]);
	});

	it("emits only the missing --publish-add flags", () => {
		expect(buildPublishUpdateArgs(builtins, desiredPublishedPorts([pg]))).toEqual([
			"--publish-add published=15432,target=15432,protocol=tcp,mode=host",
		]);
	});

	it("removes ports that no entrypoint claims any more", () => {
		const current = [
			...builtins,
			{ targetPort: 15432, publishedPort: 15432, protocol: "tcp", publishMode: "host" },
		];
		// The short `--publish-rm <target>/<proto>` form silently matches
		// nothing for a host-mode port (verified against Docker 29.7: the
		// update succeeds and the port stays published), so the full spec is
		// emitted instead.
		expect(buildPublishUpdateArgs(current, desiredPublishedPorts([]))).toEqual([
			"--publish-rm published=15432,target=15432,protocol=tcp,mode=host",
		]);
	});

	it("removes an ingress-mode port with its own mode, not a guessed one", () => {
		const current = [
			...builtins,
			{ targetPort: 1053, publishedPort: 1053, protocol: "udp", publishMode: "ingress" },
		];
		expect(buildPublishUpdateArgs(current, desiredPublishedPorts([]))).toEqual([
			"--publish-rm published=1053,target=1053,protocol=udp,mode=ingress",
		]);
	});

	it("never removes the HTTP ports, even if they are not in the desired set", () => {
		expect(buildPublishUpdateArgs(builtins, [])).toEqual([]);
	});

	it("is a no-op when the service already matches", () => {
		const desired = desiredPublishedPorts([pg, dns]);
		expect(buildPublishUpdateArgs(desired, desired)).toEqual([]);
	});

	it("treats tcp and udp on the same port as distinct mappings", () => {
		const both: TraefikEntrypointSpec[] = [
			{ name: "game-tcp", port: 27015, protocol: "tcp" },
			{ name: "game-udp", port: 27015, protocol: "udp" },
		];
		expect(buildPublishUpdateArgs(builtins, desiredPublishedPorts(both))).toEqual([
			"--publish-add published=27015,target=27015,protocol=tcp,mode=host",
			"--publish-add published=27015,target=27015,protocol=udp,mode=host",
		]);
	});
});
