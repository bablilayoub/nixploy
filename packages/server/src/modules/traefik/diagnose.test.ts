import { describe, expect, it } from "vitest";
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

	it("reads Traefik's answer the way an operator would", () => {
		expect(interpretProxyAnswer(404, null).status).toBe("fail");
		expect(interpretProxyAnswer(404, null).detail).toContain("no router");
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
