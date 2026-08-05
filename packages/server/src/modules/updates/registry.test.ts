import { describe, expect, it } from "vitest";
import { normalizeDigest, parseImageRef } from "./registry";
import { parseUpdateSettings } from "./settings";

describe("parseImageRef", () => {
	it("parses GHCR tag refs", () => {
		const ref = parseImageRef("ghcr.io/bablilayoub/nixploy:latest");
		expect(ref).toEqual({
			registry: "ghcr.io",
			repository: "bablilayoub/nixploy",
			tag: "latest",
			digest: null,
			canonical: "ghcr.io/bablilayoub/nixploy:latest",
		});
	});

	it("parses digest-pinned refs", () => {
		const digest = `sha256:${"a".repeat(64)}`;
		const ref = parseImageRef(`ghcr.io/bablilayoub/nixploy@${digest}`);
		expect(ref.tag).toBeNull();
		expect(ref.digest).toBe(digest);
		expect(ref.canonical).toBe(`ghcr.io/bablilayoub/nixploy@${digest}`);
	});

	it("defaults missing tags to latest", () => {
		expect(parseImageRef("ghcr.io/bablilayoub/nixploy").tag).toBe("latest");
	});
});

describe("normalizeDigest", () => {
	it("extracts sha256 from RepoDigest lines", () => {
		const digest = `sha256:${"b".repeat(64)}`;
		expect(normalizeDigest(`ghcr.io/bablilayoub/nixploy@${digest}`)).toBe(digest);
		expect(normalizeDigest(digest.toUpperCase())).toBe(digest);
		expect(normalizeDigest("not-a-digest")).toBeNull();
	});
});

describe("parseUpdateSettings", () => {
	it("returns defaults for empty config", () => {
		const settings = parseUpdateSettings(null);
		expect(settings.autoCheckEnabled).toBe(true);
		expect(settings.autoUpdateEnabled).toBe(false);
		expect(settings.image).toBe("ghcr.io/bablilayoub/nixploy:latest");
	});

	it("reads nested extras", () => {
		const settings = parseUpdateSettings({
			webServer: {
				autoCheckEnabled: false,
				autoUpdateEnabled: true,
				updateCheckCron: "0 4 * * *",
				updateAvailable: true,
			},
		});
		expect(settings.autoCheckEnabled).toBe(false);
		expect(settings.autoUpdateEnabled).toBe(true);
		expect(settings.checkCron).toBe("0 4 * * *");
		expect(settings.updateAvailable).toBe(true);
	});
});
