import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
	new NextRequest(`http://localhost:3000${path}`, {
		headers: cookie ? { cookie } : undefined,
	});

const location = (res: Response) => res.headers.get("location");

describe("proxy (dashboard cookie gate)", () => {
	it("sends anonymous dashboard requests to /login", () => {
		expect(location(proxy(request("/dashboard/projects")))).toBe("http://localhost:3000/login");
	});

	it("lets a request with a session cookie through to the layout's real check", () => {
		const res = proxy(request("/dashboard", "better-auth.session_token=abc"));
		expect(location(res)).toBeNull();
	});

	it("never bounces /login or /setup on cookie presence (stale cookies looped forever)", () => {
		// Regression: a stale `localhost` cookie from another panel or an expired
		// session made /login → /dashboard here while the dashboard layout sent
		// /dashboard → /login — ERR_TOO_MANY_REDIRECTS in the browser.
		const stale = "__Secure-better-auth.session_token=expired";
		expect(location(proxy(request("/login", stale)))).toBeNull();
		expect(location(proxy(request("/setup", stale)))).toBeNull();
		expect(config.matcher).not.toContain("/login");
		expect(config.matcher).not.toContain("/setup");
	});

	it("retires the legacy register route", () => {
		expect(location(proxy(request("/register")))).toBe("http://localhost:3000/setup");
	});
});
