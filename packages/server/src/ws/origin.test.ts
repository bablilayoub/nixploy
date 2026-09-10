import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	trustedOrigins: vi.fn(async () => ["https://panel.example.com"]),
}));
vi.mock("../lib/auth", () => ({ trustedOriginsWithDashboardDomain: mocks.trustedOrigins }));

import { isAllowedUpgradeOrigin } from "./index";

const request = (headers: Record<string, string>) =>
	({ headers, url: "/ws/logs" }) as unknown as IncomingMessage;

describe("isAllowedUpgradeOrigin", () => {
	it("allows non-browser upgrades without an Origin header", async () => {
		await expect(isAllowedUpgradeOrigin(request({ host: "panel.example.com" }))).resolves.toBe(
			true,
		);
	});

	it("allows same-origin upgrades regardless of the trusted list", async () => {
		await expect(
			isAllowedUpgradeOrigin(request({ host: "localhost:3000", origin: "http://localhost:3000" })),
		).resolves.toBe(true);
		await expect(
			isAllowedUpgradeOrigin(request({ host: "10.0.0.5", origin: "https://10.0.0.5" })),
		).resolves.toBe(true);
	});

	it("allows the configured trusted origins", async () => {
		await expect(
			isAllowedUpgradeOrigin(request({ host: "10.0.0.5", origin: "https://panel.example.com" })),
		).resolves.toBe(true);
	});

	it("rejects third-party and malformed origins", async () => {
		await expect(
			isAllowedUpgradeOrigin(
				request({ host: "panel.example.com", origin: "https://evil.example" }),
			),
		).resolves.toBe(false);
		await expect(
			isAllowedUpgradeOrigin(request({ host: "panel.example.com", origin: "null" })),
		).resolves.toBe(false);
		// Suffix trick: evil host ending with the panel host must not pass.
		await expect(
			isAllowedUpgradeOrigin(
				request({ host: "panel.example.com", origin: "https://evilpanel.example.com" }),
			),
		).resolves.toBe(false);
	});
});
