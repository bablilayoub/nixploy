import { describe, expect, it } from "vitest";
import { fetchStackYamlFromUrl } from "./redeploy";

describe("fetchStackYamlFromUrl SSRF guard", () => {
	it("rejects non-https", async () => {
		await expect(fetchStackYamlFromUrl("http://example.com/stack.yaml")).rejects.toThrow(/https/i);
	});

	it("rejects localhost", async () => {
		await expect(fetchStackYamlFromUrl("https://localhost/stack.yaml")).rejects.toThrow(
			/not allowed/i,
		);
	});

	it("rejects private IPv4", async () => {
		await expect(fetchStackYamlFromUrl("https://10.0.0.5/stack.yaml")).rejects.toThrow(
			/not allowed/i,
		);
		await expect(fetchStackYamlFromUrl("https://192.168.1.1/stack.yaml")).rejects.toThrow(
			/not allowed/i,
		);
		await expect(fetchStackYamlFromUrl("https://127.0.0.1/stack.yaml")).rejects.toThrow(
			/not allowed/i,
		);
	});

	it("rejects metadata hostnames", async () => {
		await expect(
			fetchStackYamlFromUrl("https://metadata.google.internal/stack.yaml"),
		).rejects.toThrow(/not allowed/i);
	});
});
