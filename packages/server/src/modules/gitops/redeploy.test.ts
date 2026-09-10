import { describe, expect, it } from "vitest";
import type { ApplyStackResult } from "./apply";
import {
	fetchStackYamlFromUrl,
	itemsToRedeploy,
	MAX_STACK_YAML_BYTES,
	readBodyWithLimit,
} from "./redeploy";

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

describe("readBodyWithLimit", () => {
	it("rejects a body whose content-length exceeds the limit without reading it", async () => {
		const res = new Response("x", {
			headers: { "content-length": String(MAX_STACK_YAML_BYTES + 1) },
		});
		await expect(readBodyWithLimit(res, MAX_STACK_YAML_BYTES)).rejects.toThrow(/too large/);
	});

	it("rejects a streamed body that grows past the limit", async () => {
		const chunk = new Uint8Array(1024);
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(chunk);
			},
		});
		await expect(readBodyWithLimit(new Response(stream), 4096)).rejects.toThrow(/too large/);
	});

	it("returns small bodies intact", async () => {
		await expect(readBodyWithLimit(new Response("version: 1\n"), 4096)).resolves.toBe(
			"version: 1\n",
		);
	});
});

describe("itemsToRedeploy", () => {
	const result = (items: ApplyStackResult["items"]): ApplyStackResult => ({
		projectId: "p1",
		environmentName: "prod",
		items,
		summary: { create: 0, update: 0, delete: 0, noop: 0 },
		applied: 0,
		errors: [],
	});

	it("redeploys creates and non-empty updates of apps/compose only", () => {
		const items = itemsToRedeploy(
			result([
				{ kind: "application", action: "create", name: "new", environment: "prod" },
				{
					kind: "application",
					action: "update",
					name: "changed",
					environment: "prod",
					changes: ["branch"],
				},
				{ kind: "application", action: "update", name: "empty", environment: "prod", changes: [] },
				{ kind: "application", action: "noop", name: "same", environment: "prod" },
				{
					kind: "compose",
					action: "update",
					name: "failed",
					environment: "prod",
					changes: ["branch"],
					error: "boom",
				},
				{
					kind: "domain",
					action: "update",
					name: "a.example.com",
					environment: "prod",
					parent: "same",
					changes: ["https"],
				},
				{ kind: "postgres", action: "create", name: "db", environment: "prod" },
			]),
		);
		expect(items.map((item) => item.name)).toEqual(["new", "changed"]);
	});
});
