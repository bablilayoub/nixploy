import { describe, expect, it } from "vitest";
import {
	applyBuiltImages,
	collectComposeBuildTargets,
	composeBuildImageTag,
	parseBuildBlock,
} from "./build";
import { parseComposeFile } from "./parse";
import { assertSafeComposeSpec } from "./safety";

describe("parseBuildBlock", () => {
	it("accepts the short form and defaults the Dockerfile", () => {
		expect(parseBuildBlock("api", "./api")).toEqual({
			serviceName: "api",
			context: "./api",
			dockerfile: "Dockerfile",
			target: null,
			argKeys: [],
		});
	});

	it("accepts the long form with a target and args in either shape", () => {
		expect(
			parseBuildBlock("api", {
				context: "services/api",
				dockerfile: "docker/Dockerfile",
				target: "runtime",
				args: { NODE_ENV: "production", SENTRY_DSN: "" },
			}),
		).toEqual({
			serviceName: "api",
			context: "services/api",
			dockerfile: "docker/Dockerfile",
			target: "runtime",
			argKeys: ["NODE_ENV", "SENTRY_DSN"],
		});
		expect(parseBuildBlock("api", { args: ["NODE_ENV=production", "PORT"] }).argKeys).toEqual([
			"NODE_ENV",
			"PORT",
		]);
	});

	it("defaults the context to the checkout root", () => {
		expect(parseBuildBlock("api", {}).context).toBe(".");
	});

	// The whole point of validating here: every one of these is a way to make
	// the build read something outside the tenant's own checkout.
	it("refuses paths that escape the checkout", () => {
		for (const context of ["../../etc", "/etc/passwd", "~/secrets", "a/../../b", "C:\\windows"]) {
			expect(() => parseBuildBlock("api", { context }), context).toThrow(/inside the repository/);
		}
		expect(() => parseBuildBlock("api", { dockerfile: "../../Dockerfile" })).toThrow(
			/inside the repository/,
		);
	});

	it("refuses a remote build context so compose never fetches one itself", () => {
		for (const context of [
			"https://github.com/acme/repo.git",
			"git@github.com:acme/repo.git",
			"git://example.com/repo",
		]) {
			expect(() => parseBuildBlock("api", { context }), context).toThrow(/not a URL/);
		}
	});

	it("refuses every escape-hatch key with a reason", () => {
		expect(() => parseBuildBlock("api", { dockerfile_inline: "FROM alpine" })).toThrow(
			/dockerfile_inline is not allowed/,
		);
		expect(() => parseBuildBlock("api", { ssh: ["default"] })).toThrow(/ssh is not allowed/);
		expect(() => parseBuildBlock("api", { secrets: ["token"] })).toThrow(/secrets is not allowed/);
		expect(() => parseBuildBlock("api", { network: "host" })).toThrow(/network is not allowed/);
		expect(() => parseBuildBlock("api", { cache_from: ["x"] })).toThrow(
			/cache_from is not allowed/,
		);
		expect(() => parseBuildBlock("api", { extra_hosts: ["a:1.2.3.4"] })).toThrow(
			/extra_hosts is not allowed/,
		);
		expect(() => parseBuildBlock("api", { tags: ["evil:latest"] })).toThrow(/tags is not allowed/);
	});

	it("refuses an unknown key rather than ignoring it", () => {
		expect(() => parseBuildBlock("api", { labels: { a: "b" } })).toThrow(/not supported/);
	});

	it("validates target and arg names", () => {
		expect(() => parseBuildBlock("api", { target: "bad stage" })).toThrow(/stage name/);
		expect(() => parseBuildBlock("api", { args: { "NOT-VALID": "x" } })).toThrow(
			/not a valid build arg name/,
		);
	});

	it("refuses a build block that is not a path or a mapping", () => {
		expect(() => parseBuildBlock("api", ["./api"])).toThrow(/path or a mapping/);
		expect(() => parseBuildBlock("api", 42)).toThrow(/path or a mapping/);
	});
});

describe("collectComposeBuildTargets", () => {
	it("returns the services that build, in file order, and nothing else", () => {
		const spec = parseComposeFile(`
services:
  api:
    build: ./api
  web:
    build:
      context: ./web
      target: prod
  cache:
    image: redis:8-alpine
`);
		expect(collectComposeBuildTargets(spec).map((t) => t.serviceName)).toEqual(["api", "web"]);
	});

	it("is empty for a stack that only pulls", () => {
		const spec = parseComposeFile("services:\n  cache:\n    image: redis:8-alpine\n");
		expect(collectComposeBuildTargets(spec)).toEqual([]);
	});
});

describe("applyBuiltImages", () => {
	const spec = parseComposeFile(`
services:
  api:
    build: ./api
    image: ignored:latest
    ports: []
  cache:
    image: redis:8-alpine
`);

	it("replaces build: with the built image and drops the declared one", () => {
		const out = applyBuiltImages(spec, new Map([["api", "stack-api:dep-1"]]));
		expect(out.services?.api).toEqual({ image: "stack-api:dep-1", ports: [] });
		// Untouched services keep their identity.
		expect(out.services?.cache).toBe(spec.services?.cache);
	});

	it("leaves the spec alone when nothing was built", () => {
		expect(applyBuiltImages(spec, new Map())).toBe(spec);
	});
});

describe("composeBuildImageTag", () => {
	it("namespaces the tag by stack and deployment", () => {
		expect(composeBuildImageTag("shop-a1b2", "api", "dep-9")).toBe("shop-a1b2-api:dep-9");
	});
});

describe("assertSafeComposeSpec with build", () => {
	const withBuild = parseComposeFile("services:\n  api:\n    build: ./api\n");

	it("still refuses build: by default, pointing at the switch", () => {
		expect(() => assertSafeComposeSpec(withBuild)).toThrow(/Build services from source/);
	});

	it("accepts a valid block once the stack opted in", () => {
		expect(() => assertSafeComposeSpec(withBuild, { allowBuild: true })).not.toThrow();
	});

	it("still refuses a dangerous block even when opted in", () => {
		const escaping = parseComposeFile("services:\n  api:\n    build:\n      context: ../../etc\n");
		expect(() => assertSafeComposeSpec(escaping, { allowBuild: true })).toThrow(
			/inside the repository/,
		);
	});
});
