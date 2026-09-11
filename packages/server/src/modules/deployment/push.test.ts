import { describe, expect, it } from "vitest";
import {
	buildLoginCommand,
	buildPushCommand,
	buildPushRef,
	buildTagCommand,
	loginServerAddress,
	normalizeImagePrefix,
} from "./push";

describe("buildPushRef", () => {
	it("uses the registry prefix, the app name and the short deployment id", () => {
		expect(buildPushRef("ghcr.io/acme", "echo-4a4487", "b1f0c3d2-4e5f-6789")).toBe(
			"ghcr.io/acme/echo-4a4487:b1f0c3d24e5f",
		);
	});

	it("tolerates a prefix stored with a scheme or a trailing slash", () => {
		expect(buildPushRef("https://registry.example.com/team/", "api", "dep-1")).toBe(
			"registry.example.com/team/api:dep1",
		);
		expect(normalizeImagePrefix("  ghcr.io/acme//  ")).toBe("ghcr.io/acme");
	});
});

describe("tag and push commands", () => {
	it("quote both references", () => {
		expect(buildTagCommand("echo-4a4487:latest", "ghcr.io/acme/echo-4a4487:dep1")).toBe(
			"docker tag 'echo-4a4487:latest' 'ghcr.io/acme/echo-4a4487:dep1'",
		);
		expect(buildPushCommand("ghcr.io/acme/echo-4a4487:dep1")).toBe(
			"docker push 'ghcr.io/acme/echo-4a4487:dep1'",
		);
	});
});

describe("buildLoginCommand", () => {
	it("never puts the password on argv", () => {
		const command = buildLoginCommand("ghcr.io", "acme-bot");
		expect(command).toBe("docker login 'ghcr.io' -u 'acme-bot' --password-stdin");
		expect(command).not.toContain("-p ");
	});
});

describe("loginServerAddress", () => {
	it("prefers the registry URL, falls back to the prefix host", () => {
		expect(loginServerAddress({ registryUrl: "https://ghcr.io/", imagePrefix: null })).toBe(
			"ghcr.io",
		);
		expect(loginServerAddress({ registryUrl: "", imagePrefix: "ghcr.io/acme" })).toBe("ghcr.io");
		expect(loginServerAddress({ registryUrl: "", imagePrefix: "registry:5000/team" })).toBe(
			"registry:5000",
		);
	});

	it("treats a bare namespace as Docker Hub", () => {
		expect(loginServerAddress({ registryUrl: "", imagePrefix: "acme" })).toBe("docker.io");
	});
});
