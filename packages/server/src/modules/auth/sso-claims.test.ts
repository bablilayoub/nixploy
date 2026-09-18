import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));

import { decodeJwtPayload } from "./sso-claims";

/** header.payload.signature, with a payload we can predict. */
const jwt = (payload: unknown): string =>
	[
		Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
		"not-a-real-signature",
	].join(".");

describe("decodeJwtPayload", () => {
	it("reads the claims of a token", () => {
		expect(decodeJwtPayload(jwt({ sub: "1", groups: ["ops"] }))).toEqual({
			sub: "1",
			groups: ["ops"],
		});
	});

	it("handles base64url padding and non-ASCII claims", () => {
		// A name with an umlaut is the classic case where base64 vs base64url
		// and UTF-8 decoding go wrong quietly.
		expect(decodeJwtPayload(jwt({ name: "Jörg Müller" }))).toEqual({ name: "Jörg Müller" });
	});

	it("returns null rather than throwing on anything that is not a token", () => {
		for (const value of ["", "not.a.jwt", "onlyonepart", "a..c", null, undefined]) {
			expect(decodeJwtPayload(value), String(value)).toBeNull();
		}
	});

	it("returns null when the payload is not an object", () => {
		const scalar = [
			Buffer.from("{}").toString("base64url"),
			Buffer.from('"just a string"').toString("base64url"),
			"sig",
		].join(".");
		expect(decodeJwtPayload(scalar)).toBeNull();
	});
});
