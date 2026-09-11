import { describe, expect, it } from "vitest";
import { describeDiff, deserializeEnv, diffEnv, parsePairs, serializeEnv } from "../utils/env.js";
import { buildSourceInput } from "./app.js";
import { parseSince } from "./audit.js";
import { assertEngine, createInputFor } from "./db.js";
import { assertMiddlewareKind, parseConfig, toSaveShape } from "./domain.js";
import { parseDomains } from "./template.js";

/**
 * Argument parsers of the hand-written commands. These translate terse CLI
 * flags into the shapes the routers validate, so a mistake here surfaces as a
 * confusing 400 from the panel rather than a local usage error.
 */

describe("env blob helpers", () => {
	it("parses KEY=VALUE pairs and rejects malformed ones", () => {
		expect(parsePairs(["A=1", "B=x=y"])).toEqual({ A: "1", B: "x=y" });
		expect(() => parsePairs(["oops"])).toThrow(/Invalid KEY=VALUE/);
		expect(() => parsePairs(["=1"])).toThrow(/Invalid KEY=VALUE/);
	});

	it("round-trips a .env blob, skipping comments and blanks", () => {
		const parsed = deserializeEnv("# note\n\nA=1\nB=2\n");
		expect(parsed).toEqual({ A: "1", B: "2" });
		expect(serializeEnv(parsed)).toBe("A=1\nB=2");
	});

	it("summarizes a diff by key, never by value", () => {
		const diff = diffEnv({ A: "1", B: "2" }, { B: "3", C: "4" });
		expect(diff).toEqual({ added: ["C"], changed: ["B"], removed: ["A"], unchanged: [] });
		const text = describeDiff(diff);
		expect(text).toContain("+1 added (C)");
		expect(text).not.toContain("3");
		expect(describeDiff(diffEnv({ A: "1" }, { A: "1" }))).toBe("no changes");
	});
});

describe("app update-source", () => {
	it("infers the docker source type", () => {
		expect(buildSourceInput("app-1", { dockerImage: "traefik/whoami:v1.10.1" })).toEqual({
			applicationId: "app-1",
			sourceType: "docker",
			dockerImage: "traefik/whoami:v1.10.1",
			registryId: null,
		});
	});

	it("infers a plain git source and carries the branch and key", () => {
		expect(
			buildSourceInput("app-1", {
				gitUrl: "git@github.com:acme/api.git",
				branch: "main",
				sshKeyId: "key-1",
			}),
		).toMatchObject({
			sourceType: "git",
			gitUrl: "git@github.com:acme/api.git",
			gitBranch: "main",
			customGitSSHKeyId: "key-1",
		});
	});

	it("infers a connected provider source", () => {
		expect(
			buildSourceInput("app-1", { githubId: "gh-1", owner: "acme", repository: "api" }),
		).toMatchObject({ sourceType: "github", githubId: "gh-1", owner: "acme", repository: "api" });
	});

	it("requires owner and repository for a provider source", () => {
		expect(() => buildSourceInput("app-1", { githubId: "gh-1" })).toThrow(/--owner/);
	});

	it("splits watch paths on commas and drops blanks", () => {
		expect(
			buildSourceInput("app-1", { dockerImage: "nginx", watchPaths: "src/, ,docs/" }),
		).toMatchObject({ watchPaths: ["src/", "docs/"] });
	});

	it("refuses to guess when no source flag is given", () => {
		expect(() => buildSourceInput("app-1", {})).toThrow(/Provide a source/);
	});
});

describe("db create", () => {
	it("accepts only the five engines", () => {
		expect(assertEngine("postgres")).toBe("postgres");
		expect(() => assertEngine("sqlite")).toThrow(/Unknown database engine/);
	});

	it("asks redis for a password only", () => {
		expect(
			createInputFor("redis", { name: "cache", environmentId: "env-1", databasePassword: "p" }),
		).toEqual({ name: "cache", environmentId: "env-1", databasePassword: "p" });
	});

	it("asks mongo for a user but not a database name", () => {
		expect(
			createInputFor("mongo", {
				name: "docs",
				environmentId: "env-1",
				databaseUser: "u",
				databasePassword: "p",
			}),
		).toMatchObject({ databaseUser: "u", databasePassword: "p" });
	});

	it("defaults the mysql root password to the user password", () => {
		expect(
			createInputFor("mysql", {
				name: "shop",
				environmentId: "env-1",
				databaseName: "shop",
				databaseUser: "u",
				databasePassword: "p",
			}),
		).toMatchObject({ databaseRootPassword: "p" });
	});

	it("reports the missing credential per engine", () => {
		expect(() => createInputFor("postgres", { name: "a", environmentId: "e" })).toThrow(
			/--password/,
		);
		expect(() =>
			createInputFor("postgres", { name: "a", environmentId: "e", databasePassword: "p" }),
		).toThrow(/--user/);
		expect(() =>
			createInputFor("postgres", {
				name: "a",
				environmentId: "e",
				databasePassword: "p",
				databaseUser: "u",
			}),
		).toThrow(/--database/);
	});

	it("passes optional infrastructure flags through", () => {
		expect(
			createInputFor("postgres", {
				name: "a",
				environmentId: "e",
				databaseName: "d",
				databaseUser: "u",
				databasePassword: "p",
				image: "postgres:18",
				externalPort: 5433,
				serverId: "srv-1",
			}),
		).toMatchObject({ dockerImage: "postgres:18", externalPort: 5433, serverId: "srv-1" });
	});
});

describe("domain middlewares", () => {
	it("accepts only the kinds the Traefik writer renders", () => {
		expect(assertMiddlewareKind("rateLimit")).toBe("rateLimit");
		expect(() => assertMiddlewareKind("basicAuth")).toThrow(/Unknown middleware kind/);
	});

	it("parses a JSON config and defaults to an empty object", () => {
		expect(parseConfig('{"average":100}')).toEqual({ average: 100 });
		expect(parseConfig(undefined)).toEqual({});
		expect(() => parseConfig("average=100")).toThrow(/JSON object/);
	});

	it("strips row ids before sending the replace-all chain", () => {
		expect(
			toSaveShape([
				{ domainMiddlewareId: "m1", kind: "compress", config: {}, order: 0, enabled: true },
			]),
		).toEqual([{ kind: "compress", config: {}, enabled: true }]);
	});
});

describe("template deploy", () => {
	it("parses host:service:port", () => {
		expect(parseDomains(["app.example.com:web:3000"])).toEqual([
			{ host: "app.example.com", serviceName: "web", port: 3000 },
		]);
	});

	it("rejects a missing part or an out-of-range port", () => {
		expect(() => parseDomains(["app.example.com:web"])).toThrow(/host:service:port/);
		expect(() => parseDomains(["app.example.com:web:70000"])).toThrow(/host:service:port/);
	});
});

describe("audit --since", () => {
	const now = new Date("2026-09-11T12:00:00Z");

	it("understands relative windows", () => {
		expect(parseSince("30m", now).toISOString()).toBe("2026-09-11T11:30:00.000Z");
		expect(parseSince("24h", now).toISOString()).toBe("2026-09-10T12:00:00.000Z");
		expect(parseSince("7d", now).toISOString()).toBe("2026-09-04T12:00:00.000Z");
	});

	it("understands an ISO timestamp", () => {
		expect(parseSince("2026-01-02T03:04:05Z", now).toISOString()).toBe("2026-01-02T03:04:05.000Z");
	});

	it("rejects anything else with a usage error", () => {
		expect(() => parseSince("last tuesday", now)).toThrow(/--since expects/);
	});

	it("names the flag it was called for", () => {
		expect(() => parseSince("nope", now, "--until")).toThrow(/--until expects/);
	});

	it("produces the ISO instant sent to audit.all", () => {
		// The window travels as an absolute timestamp so the panel never has to
		// resolve "24h" against its own clock.
		expect(parseSince("24h", now).toISOString()).toBe("2026-09-10T12:00:00.000Z");
	});
});
