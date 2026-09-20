import { describe, expect, it } from "vitest";
import { buildGitSshCommand, imageRegistryHost, shouldAttachRegistryAuth } from "./sources";

describe("buildGitSshCommand", () => {
	it("pins git hosts into a real known_hosts FILE on first contact", () => {
		const command = buildGitSshCommand("/etc/nixploy/ssh/key-1.pem");
		expect(command).toContain("-i '/etc/nixploy/ssh/key-1.pem'");
		expect(command).toContain("-o IdentitiesOnly=yes");
		// `yes` + an unpopulated file (or the old known_hosts DIRECTORY) failed
		// every custom-key clone with "Host key verification failed".
		expect(command).toContain("-o StrictHostKeyChecking=accept-new");
		expect(command).toMatch(/-o UserKnownHostsFile='[^']*\/ssh\/git_known_hosts'/);
		// Never the legacy `<ssh>/known_hosts` path — that is a directory of pins.
		expect(command).not.toMatch(/\/known_hosts'/);
	});
});

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

describe("simple-git clients", () => {
	/**
	 * Every local git client must come from `hardenedSimpleGit`: the protocol
	 * hardening rides in `GIT_CONFIG_COUNT`, and simple-git refuses a task
	 * whose environment carries it unless the client opted in. A plain
	 * `simpleGit(...)` therefore fails at run time, not at build time — it
	 * broke local clones once, and template source syncs again on 2026-09-20
	 * ("Use of \"GIT_CONFIG_COUNT\" is not permitted"), both times only
	 * visible to whoever tried it on a real install.
	 */
	it("are constructed in exactly one module", async () => {
		const { readdir, readFile } = await import("node:fs/promises");
		const path = await import("node:path");
		const root = path.join(import.meta.dirname, "..", "..");
		const offenders: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(full);
					continue;
				}
				if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
				const source = await readFile(full, "utf8");
				if (/from\s+"simple-git"/.test(source)) offenders.push(path.relative(root, full));
			}
		};
		await walk(root);
		expect(offenders).toEqual(["modules/deployment/sources.ts"]);
	});
});
