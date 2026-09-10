import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeploymentLogger, isRedactableSecret } from "./logger";

describe("isRedactableSecret (redaction floor)", () => {
	it("skips short, numeric and boolean-ish env values", () => {
		expect(isRedactableSecret("3000")).toBe(false);
		expect(isRedactableSecret("1")).toBe(false);
		expect(isRedactableSecret("12345678901")).toBe(false);
		expect(isRedactableSecret("true")).toBe(false);
		expect(isRedactableSecret("false")).toBe(false);
		expect(isRedactableSecret("production")).toBe(false);
		expect(isRedactableSecret("short")).toBe(false);
		expect(isRedactableSecret("")).toBe(false);
		expect(isRedactableSecret(null)).toBe(false);
		expect(isRedactableSecret(undefined)).toBe(false);
	});

	it("keeps real secrets", () => {
		expect(isRedactableSecret("ghp_abcdef0123456789")).toBe(true);
		expect(isRedactableSecret("postgres://user:pw@db:5432/app")).toBe(true);
		expect(isRedactableSecret("s3cr3t-pass")).toBe(true);
	});
});

describe("DeploymentLogger", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "nixploy-logger-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("redacts registered secrets but leaves PORT=3000-style values readable", async () => {
		const logPath = join(dir, "deploy.log");
		const logger = new DeploymentLogger(logPath);
		logger.addSecret("3000");
		logger.addSecret("production");
		logger.addSecret("sk-live-0123456789");
		logger.line("Listening on port 3000 in production with key sk-live-0123456789");
		logger.close();

		const content = await readFile(logPath, "utf8");
		expect(content).toContain("port 3000 in production");
		expect(content).not.toContain("sk-live-0123456789");
		expect(content).toContain("**********");
		expect(logger.listSecrets()).toEqual(["sk-live-0123456789"]);
	});
});
