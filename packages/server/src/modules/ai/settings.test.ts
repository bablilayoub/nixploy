import { describe, expect, it } from "vitest";
import { assertSafeAiBaseUrl } from "./settings";

describe("assertSafeAiBaseUrl", () => {
	it("allows ollama on loopback:11434", async () => {
		await expect(
			assertSafeAiBaseUrl("http://127.0.0.1:11434/v1", "ollama"),
		).resolves.toBeUndefined();
	});

	it("blocks loopback Docker API / DB ports for local AI providers", async () => {
		await expect(assertSafeAiBaseUrl("http://127.0.0.1:2375", "openai-compatible")).rejects.toThrow(
			/port is not allowed/,
		);
		await expect(assertSafeAiBaseUrl("http://localhost:5432", "ollama")).rejects.toThrow(
			/port is not allowed/,
		);
		await expect(assertSafeAiBaseUrl("http://127.0.0.1:22", "openai-compatible")).rejects.toThrow(
			/port is not allowed/,
		);
	});

	it("blocks cloud metadata hosts", async () => {
		await expect(
			assertSafeAiBaseUrl("http://169.254.169.254/latest", "openai-compatible"),
		).rejects.toThrow(/metadata/);
	});
});
