import { describe, expect, it } from "vitest";
import { shouldRequireTwoFactorSetup } from "./two-factor-gate";

describe("shouldRequireTwoFactorSetup", () => {
	it("allows everyone when the org does not require 2FA", () => {
		expect(
			shouldRequireTwoFactorSetup({ orgRequiresTwoFactor: false, userTwoFactorEnabled: false }),
		).toBe(false);
		expect(
			shouldRequireTwoFactorSetup({ orgRequiresTwoFactor: false, userTwoFactorEnabled: true }),
		).toBe(false);
	});

	it("allows members with 2FA when the org requires it", () => {
		expect(
			shouldRequireTwoFactorSetup({ orgRequiresTwoFactor: true, userTwoFactorEnabled: true }),
		).toBe(false);
	});

	it("gates members without 2FA when the org requires it", () => {
		expect(
			shouldRequireTwoFactorSetup({ orgRequiresTwoFactor: true, userTwoFactorEnabled: false }),
		).toBe(true);
	});

	it("treats a null/undefined flag as not enabled", () => {
		expect(
			shouldRequireTwoFactorSetup({ orgRequiresTwoFactor: true, userTwoFactorEnabled: null }),
		).toBe(true);
		expect(
			shouldRequireTwoFactorSetup({ orgRequiresTwoFactor: true, userTwoFactorEnabled: undefined }),
		).toBe(true);
	});
});
