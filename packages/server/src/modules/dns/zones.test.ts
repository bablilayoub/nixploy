import { describe, expect, it } from "vitest";
import {
	candidateZoneNames,
	findZoneForHost,
	fqdnOf,
	isAutomatableHost,
	normalizeHost,
	relativeRecordName,
} from "./zones";

describe("normalizeHost", () => {
	it("lower-cases and strips the trailing dot", () => {
		expect(normalizeHost(" App.Example.COM. ")).toBe("app.example.com");
	});
});

describe("isAutomatableHost", () => {
	it("accepts ordinary public hosts and wildcards", () => {
		expect(isAutomatableHost("app.example.com")).toBe(true);
		expect(isAutomatableHost("*.apps.example.com")).toBe(true);
		expect(isAutomatableHost("example.com")).toBe(true);
	});
	it("refuses literals, bare names and magic-DNS domains", () => {
		expect(isAutomatableHost("203.0.113.10")).toBe(false);
		expect(isAutomatableHost("localhost")).toBe(false);
		expect(isAutomatableHost("api.localhost")).toBe(false);
		expect(isAutomatableHost("demo-abc.traefik.me")).toBe(false);
		expect(isAutomatableHost("10-0-0-1.sslip.io")).toBe(false);
		expect(isAutomatableHost("app.nip.io")).toBe(false);
		expect(isAutomatableHost("")).toBe(false);
	});
});

describe("findZoneForHost", () => {
	const zones = [
		{ id: "1", name: "example.com" },
		{ id: "2", name: "eu.example.com" },
		{ id: "3", name: "other.dev" },
	];
	it("picks the longest matching apex", () => {
		expect(findZoneForHost("app.eu.example.com", zones)?.id).toBe("2");
		expect(findZoneForHost("app.example.com", zones)?.id).toBe("1");
		expect(findZoneForHost("example.com", zones)?.id).toBe("1");
	});
	it("matches a wildcard on its parent", () => {
		expect(findZoneForHost("*.eu.example.com", zones)?.id).toBe("2");
		expect(findZoneForHost("*.example.com", zones)?.id).toBe("1");
	});
	it("does not match a suffix that is not on a label boundary", () => {
		expect(findZoneForHost("notexample.com", zones)).toBeNull();
		expect(findZoneForHost("app.example.org", zones)).toBeNull();
	});
	it("ignores case and trailing dots", () => {
		expect(findZoneForHost("App.Example.com.", [{ id: "1", name: "EXAMPLE.COM." }])?.id).toBe("1");
	});
});

describe("relativeRecordName / fqdnOf", () => {
	it("round-trips sub-names, wildcards and the apex", () => {
		expect(relativeRecordName("app.example.com", "example.com")).toBe("app");
		expect(relativeRecordName("a.b.example.com", "example.com")).toBe("a.b");
		expect(relativeRecordName("*.apps.example.com", "example.com")).toBe("*.apps");
		expect(relativeRecordName("*.example.com", "example.com")).toBe("*");
		expect(relativeRecordName("example.com", "example.com")).toBe("@");
		expect(fqdnOf("example.com", "app")).toBe("app.example.com");
		expect(fqdnOf("example.com", "@")).toBe("example.com");
		expect(fqdnOf("example.com", "")).toBe("example.com");
		expect(fqdnOf("example.com", "*.apps")).toBe("*.apps.example.com");
	});
	it("refuses a host outside the zone", () => {
		expect(() => relativeRecordName("app.other.dev", "example.com")).toThrow(/not inside/);
	});
});

describe("candidateZoneNames", () => {
	it("lists every apex, longest first, never the TLD alone", () => {
		expect(candidateZoneNames("a.b.example.com")).toEqual([
			"a.b.example.com",
			"b.example.com",
			"example.com",
		]);
		expect(candidateZoneNames("*.apps.example.com")).toEqual(["apps.example.com", "example.com"]);
		expect(candidateZoneNames("example.com")).toEqual(["example.com"]);
	});
});
