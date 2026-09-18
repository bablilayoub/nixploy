import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APP_AUTH_COOKIE,
	consumeExchangeCode,
	issueExchangeCode,
	issueSessionCookie,
	readSessionCookie,
	safeReturnPath,
} from "./tokens";

/**
 * The two tokens forward-auth hands to a browser. Every test here is a way the
 * cookie must NOT be accepted: another host, a forged signature, an expired
 * stamp, a replayed code. The signing key comes from `ENCRYPTION_KEY`, which
 * `vitest.config.ts` sets for the whole run.
 */

const session = { u: "user_1", e: "casey@example.com", n: "Casey", g: ["member"], h: "app.test" };

describe("session cookie", () => {
	it("round-trips for the host it was issued for", () => {
		const token = issueSessionCookie(session, 3600);
		expect(readSessionCookie(token, "app.test")).toMatchObject({ u: "user_1", h: "app.test" });
	});

	it("is refused on another host", () => {
		// Cookies are host-only anyway; this is the second lock, for a cookie
		// that arrives somewhere it should not have.
		const token = issueSessionCookie(session, 3600);
		expect(readSessionCookie(token, "other.test")).toBeNull();
	});

	it("is refused once it has expired", () => {
		vi.useFakeTimers();
		try {
			const token = issueSessionCookie(session, 60);
			vi.advanceTimersByTime(61_000);
			expect(readSessionCookie(token, "app.test")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("is refused when the payload is edited", () => {
		const token = issueSessionCookie(session, 3600);
		const [body, signature] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({ ...session, u: "user_2", x: Math.floor(Date.now() / 1000) + 3600 }),
		).toString("base64url");
		expect(body).not.toBe(forged);
		expect(readSessionCookie(`${forged}.${signature}`, "app.test")).toBeNull();
	});

	it("is refused for garbage", () => {
		for (const bad of ["", "abc", "a.b", "....", null, undefined]) {
			expect(readSessionCookie(bad, "app.test")).toBeNull();
		}
	});

	it("names the cookie the verify endpoint reads", () => {
		expect(APP_AUTH_COOKIE).toBe("nixploy_app_auth");
	});
});

describe("exchange code", () => {
	const payload = { ...session, r: "/dashboard", t: 3600 };

	beforeEach(() => {
		(globalThis as { __nixployAppAuthCodes?: Map<string, number> }).__nixployAppAuthCodes?.clear();
	});
	afterEach(() => vi.useRealTimers());

	it("can be used exactly once", () => {
		const code = issueExchangeCode(payload);
		expect(consumeExchangeCode(code, "app.test")).toMatchObject({ u: "user_1", r: "/dashboard" });
		expect(consumeExchangeCode(code, "app.test")).toBeNull();
	});

	it("is refused on another host", () => {
		expect(consumeExchangeCode(issueExchangeCode(payload), "other.test")).toBeNull();
	});

	it("expires in two minutes", () => {
		vi.useFakeTimers();
		const code = issueExchangeCode(payload);
		vi.advanceTimersByTime(121_000);
		expect(consumeExchangeCode(code, "app.test")).toBeNull();
	});

	it("cannot be used as a session cookie", () => {
		// Different info strings, so the two kinds cannot be swapped even though
		// they share a chain and a wire format.
		const code = issueExchangeCode(payload);
		expect(readSessionCookie(code, "app.test")).toBeNull();
		const cookie = issueSessionCookie(session, 3600);
		expect(consumeExchangeCode(cookie, "app.test")).toBeNull();
	});
});

describe("safeReturnPath", () => {
	it("keeps an ordinary absolute path", () => {
		expect(safeReturnPath("/admin?tab=1#x")).toBe("/admin?tab=1#x");
	});

	it("refuses everything that could leave the host", () => {
		for (const bad of ["//evil.test/", "https://evil.test", "evil.test", "\\\\evil.test", null]) {
			expect(safeReturnPath(bad)).toBe("/");
		}
	});

	it("refuses a header-splitting path", () => {
		expect(safeReturnPath("/a\r\nSet-Cookie: x=1")).toBe("/");
	});
});
