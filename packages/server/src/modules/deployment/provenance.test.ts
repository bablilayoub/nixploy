import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let configDir: string;

beforeAll(async () => {
	configDir = await mkdtemp(join(tmpdir(), "nixploy-provenance-"));
	process.env.NIXPLOY_CONFIG_DIR = configDir;
});

afterAll(async () => {
	delete process.env.NIXPLOY_CONFIG_DIR;
	await rm(configDir, { recursive: true, force: true });
});

const load = async () => await import("./provenance");

describe("provenanceForSession", () => {
	it("attributes browser sessions to the user as manual", async () => {
		const { provenanceForSession, isApiKeySession } = await load();
		const session = { user: { id: "user-1" }, session: { id: "sess-1", token: "abc" } };
		expect(isApiKeySession(session)).toBe(false);
		expect(provenanceForSession(session)).toEqual({ trigger: "manual", triggeredBy: "user-1" });
	});

	it("recognises the synthesized API-key session (REST, MCP, CLI)", async () => {
		const { provenanceForSession, isApiKeySession } = await load();
		const byToken = { user: { id: "user-2" }, session: { id: "x", token: "api-key" } };
		const byId = { user: { id: "user-2" }, session: { id: "api-key_k1", token: null } };
		expect(isApiKeySession(byToken)).toBe(true);
		expect(isApiKeySession(byId)).toBe(true);
		expect(provenanceForSession(byToken)).toEqual({ trigger: "api", triggeredBy: "user-2" });
	});
});

describe("applicationReadiness", () => {
	it("needs an image for docker sources", async () => {
		const { applicationReadiness, SOURCE_NOT_CONFIGURED } = await load();
		await expect(
			applicationReadiness({ appName: "a", sourceType: "docker", dockerImage: "  " }),
		).resolves.toEqual({ canDeploy: false, reason: SOURCE_NOT_CONFIGURED });
		await expect(
			applicationReadiness({ appName: "a", sourceType: "docker", dockerImage: "nginx:1" }),
		).resolves.toEqual({ canDeploy: true });
	});

	it("needs a git URL for generic git and owner+repository for providers", async () => {
		const { applicationReadiness } = await load();
		await expect(
			applicationReadiness({ appName: "a", sourceType: "git", gitUrl: null }),
		).resolves.toMatchObject({ canDeploy: false });
		await expect(
			applicationReadiness({ appName: "a", sourceType: "git", gitUrl: "https://x/y.git" }),
		).resolves.toEqual({ canDeploy: true });
		for (const sourceType of ["github", "gitlab", "bitbucket", "gitea"] as const) {
			await expect(
				applicationReadiness({ appName: "a", sourceType, owner: "o", repository: "" }),
			).resolves.toMatchObject({ canDeploy: false });
			await expect(
				applicationReadiness({ appName: "a", sourceType, owner: "o", repository: "r" }),
			).resolves.toEqual({ canDeploy: true });
		}
	});

	it("needs the uploaded archive for drop sources", async () => {
		const { applicationReadiness } = await load();
		const { getDropZipPath } = await import("./paths");
		await expect(
			applicationReadiness({ appName: "drop-app", sourceType: "drop" }),
		).resolves.toMatchObject({ canDeploy: false, reason: expect.stringContaining("zip") });
		const zipPath = getDropZipPath("drop-app");
		await import("node:fs/promises").then((fs) =>
			fs.mkdir(join(zipPath, ".."), { recursive: true }),
		);
		await writeFile(zipPath, "PK");
		await expect(
			applicationReadiness({ appName: "drop-app", sourceType: "drop" }),
		).resolves.toEqual({ canDeploy: true });
	});
});

describe("composeReadiness", () => {
	it("needs a non-empty file for raw sources and a repo otherwise", async () => {
		const { composeReadiness } = await load();
		expect(composeReadiness({ sourceType: "raw", composeFile: "\n  " })).toMatchObject({
			canDeploy: false,
		});
		expect(composeReadiness({ sourceType: "raw", composeFile: "services: {}" })).toEqual({
			canDeploy: true,
		});
		expect(composeReadiness({ sourceType: "git", gitUrl: "" })).toMatchObject({
			canDeploy: false,
		});
		expect(composeReadiness({ sourceType: "github", owner: "o", repository: null })).toMatchObject({
			canDeploy: false,
		});
		expect(composeReadiness({ sourceType: "github", owner: "o", repository: "r" })).toEqual({
			canDeploy: true,
		});
	});
});

describe("parseCheckoutCommit", () => {
	it("parses sha / author / subject lines", async () => {
		const { parseCheckoutCommit } = await load();
		expect(
			parseCheckoutCommit("0123456789abcdef0123456789abcdef01234567\nJane Doe\nfix: thing\n"),
		).toEqual({
			sha: "0123456789abcdef0123456789abcdef01234567",
			author: "Jane Doe",
			message: "fix: thing",
		});
	});

	it("tolerates CRLF and missing author/subject, rejects garbage", async () => {
		const { parseCheckoutCommit } = await load();
		expect(parseCheckoutCommit("abcdef1\r\n\r\n\r\n")).toEqual({
			sha: "abcdef1",
			author: null,
			message: null,
		});
		expect(parseCheckoutCommit("fatal: not a git repository")).toBeNull();
		expect(parseCheckoutCommit("")).toBeNull();
	});
});

describe("firstLine", () => {
	it("returns the first non-empty trimmed line", async () => {
		const { firstLine } = await load();
		expect(firstLine("\n\n  Build failed: exit 1  \nmore")).toBe("Build failed: exit 1");
		expect(firstLine(null)).toBeNull();
		expect(firstLine("   ")).toBeNull();
	});
});
