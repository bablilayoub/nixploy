import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deploymentEvents } from "./events";
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

	it("announces every redacted chunk on deploymentEvents when it knows its deploymentId", async () => {
		const events: Array<{ deploymentId: string; chunk: string }> = [];
		const onLog = (event: { deploymentId: string; chunk: string }) => {
			events.push(event);
		};
		deploymentEvents.on("log", onLog);
		try {
			const logger = new DeploymentLogger(join(dir, "live.log"), "dep-1");
			logger.addSecret("sk-live-0123456789");
			logger.write("token sk-live-0123456789\n");
			logger.line("second");
			logger.close();
			logger.write("after close");

			expect(events).toEqual([
				{ deploymentId: "dep-1", chunk: "token **********\n" },
				{ deploymentId: "dep-1", chunk: "second\n" },
			]);

			// Without an id (schedule/rollback logs) nothing is emitted.
			const anonymous = new DeploymentLogger(join(dir, "anon.log"));
			anonymous.line("quiet");
			expect(events).toHaveLength(2);
		} finally {
			deploymentEvents.off("log", onLog);
		}
	});
});

describe("redaction floor (security audit 2.4)", () => {
	it("redacts short secret-shaped values", () => {
		expect(isRedactableSecret("s3cr")).toBe(true);
		expect(isRedactableSecret("a1b2")).toBe(true);
		expect(isRedactableSecret("p@ss")).toBe(true);
		expect(isRedactableSecret("hunter22")).toBe(true);
	});

	it("still ignores numbers, booleans and short plain words", () => {
		expect(isRedactableSecret("3000")).toBe(false);
		expect(isRedactableSecret("true")).toBe(false);
		expect(isRedactableSecret("main")).toBe(false);
		expect(isRedactableSecret("prod")).toBe(false);
		expect(isRedactableSecret("utf8")).toBe(true);
		expect(isRedactableSecret("abc")).toBe(false);
		expect(isRedactableSecret("")).toBe(false);
	});
});
