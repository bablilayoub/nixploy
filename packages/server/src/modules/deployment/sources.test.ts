import { describe, expect, it } from "vitest";
import { imageRegistryHost, shouldAttachRegistryAuth } from "./sources";

describe("imageRegistryHost", () => {
	it("defaults bare and namespaced images to docker.io", () => {
		expect(imageRegistryHost("ubuntu")).toBe("docker.io");
		expect(imageRegistryHost("ubuntu:22.04")).toBe("docker.io");
		expect(imageRegistryHost("foo/bar")).toBe("docker.io");
		expect(imageRegistryHost("library/ubuntu:22.04")).toBe("docker.io");
		expect(imageRegistryHost("foo/bar/baz:1.0")).toBe("docker.io");
	});

	it("extracts the registry host from prefixed references", () => {
		expect(imageRegistryHost("ghcr.io/x/y")).toBe("ghcr.io");
		expect(imageRegistryHost("ghcr.io/x/y:latest")).toBe("ghcr.io");
		expect(imageRegistryHost("registry.example.com/team/app")).toBe("registry.example.com");
		expect(imageRegistryHost("registry.example.com:5000/team/app")).toBe(
			"registry.example.com:5000",
		);
		expect(imageRegistryHost("localhost:5000/app")).toBe("localhost:5000");
		expect(imageRegistryHost("localhost/app")).toBe("localhost");
		expect(imageRegistryHost("GHCR.IO/X/Y")).toBe("ghcr.io");
	});
});

describe("shouldAttachRegistryAuth", () => {
	const ghcr = { registryUrl: "https://ghcr.io", imagePrefix: null };
	const hub = { registryUrl: "https://index.docker.io/v1/", imagePrefix: null };

	it("attaches credentials when the image lives in the configured registry", () => {
		expect(shouldAttachRegistryAuth(ghcr, "ghcr.io/x/y")).toBe(true);
		expect(shouldAttachRegistryAuth(ghcr, "ghcr.io/x/y:latest")).toBe(true);
		expect(shouldAttachRegistryAuth(hub, "foo/bar")).toBe(true);
		expect(shouldAttachRegistryAuth(hub, "ubuntu:22.04")).toBe(true);
	});

	it("refuses to send credentials to a different registry", () => {
		expect(shouldAttachRegistryAuth(ghcr, "foo/bar")).toBe(false);
		expect(shouldAttachRegistryAuth(ghcr, "evil.example.com/x/y")).toBe(false);
		expect(shouldAttachRegistryAuth(hub, "ghcr.io/x/y")).toBe(false);
	});

	it("normalizes docker.io aliases and missing protocols", () => {
		expect(
			shouldAttachRegistryAuth({ registryUrl: "docker.io", imagePrefix: null }, "foo/bar"),
		).toBe(true);
		expect(
			shouldAttachRegistryAuth(
				{ registryUrl: "registry-1.docker.io", imagePrefix: null },
				"foo/bar",
			),
		).toBe(true);
		expect(
			shouldAttachRegistryAuth({ registryUrl: "ghcr.io", imagePrefix: null }, "ghcr.io/a/b"),
		).toBe(true);
		expect(
			shouldAttachRegistryAuth(
				{ registryUrl: "https://ghcr.io/", imagePrefix: null },
				"ghcr.io/a/b",
			),
		).toBe(true);
	});

	it("matches via imagePrefix namespaces", () => {
		expect(
			shouldAttachRegistryAuth(
				{ registryUrl: "https://ghcr.io", imagePrefix: "ghcr.io/my-org" },
				"ghcr.io/my-org/app",
			),
		).toBe(true);
		expect(shouldAttachRegistryAuth({ registryUrl: "", imagePrefix: null }, "foo/bar")).toBe(true); // no recorded host: docker hub default
		expect(
			shouldAttachRegistryAuth({ registryUrl: null, imagePrefix: null }, "ghcr.io/foo/bar"),
		).toBe(false); // inline creds never leave docker.io
	});

	it("returns false without auth", () => {
		expect(shouldAttachRegistryAuth(null, "ghcr.io/x/y")).toBe(false);
	});
});
