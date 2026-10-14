import { describe, expect, it } from "vitest";
import { buildTraefikFileConfig } from "./config-writer";
import { fileRoutesHost, interpretProxyAnswer, verdictOf } from "./diagnose";

describe("route diagnostician", () => {
	it("finds a host in a dynamic file's routers regardless of case", () => {
		const document = {
			http: {
				routers: {
					"shop-router-a": { rule: "Host(`Shop.Example.com`) && PathPrefix(`/api`)" },
				},
			},
		};
		expect(fileRoutesHost(document, "shop.example.com")).toBe(true);
		expect(fileRoutesHost(document, "other.example.com")).toBe(false);
		expect(fileRoutesHost({ tcp: {} }, "shop.example.com")).toBe(false);
		expect(fileRoutesHost(null, "shop.example.com")).toBe(false);
	});

	it("recognizes the wildcard rule emitted by the config writer", async () => {
		const document = await buildTraefikFileConfig({
			appName: "wildcard",
			domains: [{ host: "*.apps.example.com", port: 80, https: true, certificateType: "none" }],
		});
		expect(fileRoutesHost(document, "*.apps.example.com")).toBe(true);
		expect(fileRoutesHost(document, "*.other.example.com")).toBe(false);
	});

	it("distinguishes supported same-host paths and ignores host text outside Host matchers", () => {
		const document = {
			http: {
				routers: {
					api: { rule: "Host(`shop.example.com`) && PathPrefix(`/api`)" },
				},
			},
		};
		expect(fileRoutesHost(document, "shop.example.com", "/api")).toBe(true);
		expect(fileRoutesHost(document, "shop.example.com", "/")).toBe(false);
		expect(fileRoutesHost(document, "shop.example.com", "/API")).toBe(false);
		expect(
			fileRoutesHost(
				{
					http: {
						routers: {
							wrong: { rule: "Host(`other.example.com`) && PathPrefix(`shop.example.com`)" },
						},
					},
				},
				"shop.example.com",
			),
		).toBe(false);
	});

	it("does not mistake an application 404 for a missing Traefik router", () => {
		expect(interpretProxyAnswer(404, null, "<h1>Product not found</h1>")).toMatchObject({
			status: "ok",
		});
		expect(interpretProxyAnswer(404, null, "404 page not found\n")).toMatchObject({
			status: "warn",
		});
	});

	it("reads Traefik's answer the way an operator would", () => {
		expect(interpretProxyAnswer(404, null).status).toBe("warn");
		expect(interpretProxyAnswer(502, null)).toMatchObject({ status: "fail" });
		expect(interpretProxyAnswer(503, null)).toMatchObject({ status: "fail" });
		expect(interpretProxyAnswer(500, null)).toMatchObject({ status: "warn" });
		expect(interpretProxyAnswer(200, null)).toMatchObject({ status: "ok" });
		expect(interpretProxyAnswer(302, null)).toMatchObject({ status: "ok" });
		expect(interpretProxyAnswer(null, "ECONNREFUSED")).toMatchObject({ status: "skip" });
	});

	it("aggregates a verdict", () => {
		const ok = { id: "a", status: "ok" as const, title: "", detail: "" };
		expect(verdictOf([ok, { ...ok, status: "skip" }])).toBe("healthy");
		expect(verdictOf([ok, { ...ok, status: "warn" }])).toBe("degraded");
		expect(verdictOf([ok, { ...ok, status: "warn" }, { ...ok, status: "fail" }])).toBe("broken");
	});
});
