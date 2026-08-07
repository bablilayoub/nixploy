import { describe, expect, it } from "vitest";
import { extractYamlDocument, validateComposeYaml } from "./generate-compose";

describe("validateComposeYaml", () => {
	it("accepts a minimal services map", () => {
		expect(
			validateComposeYaml(`
services:
  web:
    image: nginx:alpine
`),
		).toEqual({ ok: true });
	});

	it("rejects missing services", () => {
		const result = validateComposeYaml("version: '3'\n");
		expect(result.ok).toBe(false);
	});
});

describe("extractYamlDocument", () => {
	it("strips markdown fences", () => {
		const yaml = extractYamlDocument("```yaml\nservices:\n  a:\n    image: x\n```");
		expect(yaml.startsWith("services:")).toBe(true);
	});
});
