import { describe, expect, it } from "vitest";
import { isPlausibleHost, planTemplateDomains } from "./domains";

const template = {
	env: [
		{ key: "ENDPOINT", default: "tunnel.example.com", description: "" },
		{ key: "ZONE", default: "tunnels.example.com", description: "" },
		{ key: "TOKEN", default: "{{generateSecret}}", description: "" },
	],
	domains: [
		{ env: "ENDPOINT", serviceName: "edge", port: 8080 },
		{ env: "ZONE", serviceName: "edge", port: 8080, wildcard: true },
	],
};

describe("planTemplateDomains", () => {
	it("attaches the hosts the operator typed, wildcards prefixed", () => {
		expect(
			planTemplateDomains(template, { ENDPOINT: "Tunnel.Acme.dev", ZONE: "t.acme.dev" }),
		).toEqual([
			{
				env: "ENDPOINT",
				host: "tunnel.acme.dev",
				serviceName: "edge",
				port: 8080,
				https: true,
				wildcard: false,
			},
			{
				env: "ZONE",
				host: "*.t.acme.dev",
				serviceName: "edge",
				port: 8080,
				https: true,
				wildcard: true,
			},
		]);
	});
	it("skips a value still at the template's placeholder, blank or missing", () => {
		expect(planTemplateDomains(template, { ENDPOINT: "tunnel.example.com", ZONE: " " })).toEqual(
			[],
		);
		expect(planTemplateDomains(template, {})).toEqual([]);
	});
	it("skips a value that is not a hostname and tolerates a typed wildcard", () => {
		expect(planTemplateDomains(template, { ENDPOINT: "not a host", ZONE: "*.t.acme.dev" })).toEqual(
			[expect.objectContaining({ host: "*.t.acme.dev" })],
		);
		expect(planTemplateDomains(template, { ENDPOINT: "localhost" })).toEqual([]);
		expect(planTemplateDomains(template, { ENDPOINT: "https://x.acme.dev" })).toEqual([]);
	});
	it("drops duplicates and honours https: false", () => {
		const plain = {
			...template,
			domains: [
				{ env: "ENDPOINT", serviceName: "edge", port: 8080, https: false },
				{ env: "ENDPOINT", serviceName: "edge", port: 9090 },
			],
		};
		expect(planTemplateDomains(plain, { ENDPOINT: "a.acme.dev" })).toEqual([
			expect.objectContaining({ host: "a.acme.dev", https: false, port: 8080 }),
		]);
	});
	it("does nothing for a template without hints", () => {
		expect(planTemplateDomains({ env: template.env }, { ENDPOINT: "a.acme.dev" })).toEqual([]);
	});
});

describe("isPlausibleHost", () => {
	it("wants at least two labels and no rule metacharacters", () => {
		expect(isPlausibleHost("a.acme.dev")).toBe(true);
		expect(isPlausibleHost("acme")).toBe(false);
		expect(isPlausibleHost("a.acme.dev.")).toBe(true);
		expect(isPlausibleHost("a(b).acme.dev")).toBe(false);
		expect(isPlausibleHost("*.acme.dev")).toBe(false);
	});
});
