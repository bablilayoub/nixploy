import { describe, expect, it } from "vitest";
import { isUsableRpId, resolvePasskeyRelyingParty } from "./passkey-rp";

/**
 * The whole point of this module is refusing to pretend. `@better-auth/passkey`
 * defaults `rpID` to "localhost", so an install that never resolves a real one
 * offers a button whose every press fails inside the browser.
 */

describe("isUsableRpId", () => {
	it("accepts a registrable domain", () => {
		expect(isUsableRpId("panel.example.com")).toBe(true);
		expect(isUsableRpId("example.co.uk")).toBe(true);
		expect(isUsableRpId("PANEL.Example.com")).toBe(true);
	});

	it("accepts localhost, which browsers allow without a certificate", () => {
		expect(isUsableRpId("localhost")).toBe(true);
		expect(isUsableRpId("panel.localhost")).toBe(true);
	});

	it("refuses an IP address — WebAuthn has no domain to bind to", () => {
		expect(isUsableRpId("5.6.7.8")).toBe(false);
		expect(isUsableRpId("127.0.0.1")).toBe(false);
		expect(isUsableRpId("::1")).toBe(false);
		expect(isUsableRpId("[2001:db8::1]")).toBe(false);
	});

	it("refuses a bare label, empty input and anything oversized", () => {
		expect(isUsableRpId("intranet")).toBe(false);
		expect(isUsableRpId("")).toBe(false);
		expect(isUsableRpId("   ")).toBe(false);
		expect(isUsableRpId(`${"a".repeat(250)}.com`)).toBe(false);
	});

	it("refuses a host with a port, a scheme or a path in it", () => {
		expect(isUsableRpId("example.com:3000")).toBe(false);
		expect(isUsableRpId("https://example.com")).toBe(false);
		expect(isUsableRpId("example.com/panel")).toBe(false);
	});
});

describe("resolvePasskeyRelyingParty", () => {
	it("prefers the configured dashboard domain", () => {
		const rp = resolvePasskeyRelyingParty("panel.example.com", "https://panel.example.com");
		expect(rp).toEqual({
			rpId: "panel.example.com",
			origins: ["https://panel.example.com"],
		});
	});

	it("keeps both origins when the base URL differs from the domain", () => {
		// A checkout pointed at a staging domain: both are legitimate places for
		// the browser to present the credential from.
		const rp = resolvePasskeyRelyingParty("panel.example.com", "http://localhost:3100");
		expect(rp?.rpId).toBe("panel.example.com");
		expect(rp?.origins).toEqual(["http://localhost:3100", "https://panel.example.com"]);
	});

	it("falls back to the base URL before anything is configured", () => {
		const rp = resolvePasskeyRelyingParty(null, "http://localhost:3100");
		// The port belongs in the origin and must NOT be in the rpID.
		expect(rp).toEqual({ rpId: "localhost", origins: ["http://localhost:3100"] });
	});

	it("is null when the panel is only reachable by IP", () => {
		expect(resolvePasskeyRelyingParty(null, "https://5.6.7.8")).toBeNull();
		expect(resolvePasskeyRelyingParty("5.6.7.8", "https://5.6.7.8")).toBeNull();
	});

	it("ignores an IP dashboard host but still uses a usable base URL", () => {
		const rp = resolvePasskeyRelyingParty("5.6.7.8", "https://panel.example.com");
		expect(rp?.rpId).toBe("panel.example.com");
	});

	it("is null with nothing configured at all", () => {
		expect(resolvePasskeyRelyingParty(null, null)).toBeNull();
		expect(resolvePasskeyRelyingParty("", "not a url")).toBeNull();
	});
});
