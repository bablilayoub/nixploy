import { afterEach, describe, expect, it } from "vitest";
import { maskEmail, requiresSetupToken, setupToken, setupTokenMatches } from "./setup";

const ORIGINAL = process.env.NIXPLOY_SETUP_TOKEN;

afterEach(() => {
	if (ORIGINAL === undefined) delete process.env.NIXPLOY_SETUP_TOKEN;
	else process.env.NIXPLOY_SETUP_TOKEN = ORIGINAL;
});

describe("setup token", () => {
	it("is not required when NIXPLOY_SETUP_TOKEN is unset or blank", () => {
		delete process.env.NIXPLOY_SETUP_TOKEN;
		expect(requiresSetupToken()).toBe(false);
		expect(setupToken()).toBeNull();
		// Nothing to prove: every candidate passes, including none.
		expect(setupTokenMatches(null)).toBe(true);
		expect(setupTokenMatches("anything")).toBe(true);

		process.env.NIXPLOY_SETUP_TOKEN = "   ";
		expect(requiresSetupToken()).toBe(false);
		expect(setupTokenMatches(undefined)).toBe(true);
	});

	it("accepts only the configured token once set", () => {
		process.env.NIXPLOY_SETUP_TOKEN = "s3cr3t-token";
		expect(requiresSetupToken()).toBe(true);
		expect(setupTokenMatches("s3cr3t-token")).toBe(true);
		expect(setupTokenMatches("  s3cr3t-token  ")).toBe(true);
		expect(setupTokenMatches("s3cr3t-toke")).toBe(false);
		expect(setupTokenMatches("s3cr3t-tokenX")).toBe(false);
		expect(setupTokenMatches("")).toBe(false);
		expect(setupTokenMatches(null)).toBe(false);
		expect(setupTokenMatches(undefined)).toBe(false);
	});
});

describe("maskEmail", () => {
	it("keeps the domain and the first two characters only", () => {
		expect(maskEmail("ada.lovelace@example.com")).toBe("ad••••••••••@example.com");
		expect(maskEmail("bo@example.com")).toBe("bo•••@example.com");
		expect(maskEmail("a@example.com")).toBe("a•••@example.com");
	});

	it("never returns the full local part", () => {
		for (const email of ["ada@x.io", "operations-team@corp.example", "q@q.q"]) {
			expect(maskEmail(email)).not.toBe(email);
			expect(maskEmail(email)).toContain("•");
		}
	});

	it("degrades safely on malformed input", () => {
		expect(maskEmail("not-an-email")).toBe("•••");
		expect(maskEmail("@example.com")).toBe("•••");
	});
});
