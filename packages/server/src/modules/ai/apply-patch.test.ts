import { describe, expect, it } from "vitest";
import { extractEnvEntries, isEnvLikePatch, mergeDotenv } from "./apply-patch";

describe("apply-patch", () => {
	it("extracts KEY=VALUE lines from fenced patches", () => {
		const patch = "```env\nFOO=bar\n# comment\nBAZ=qux\n```";
		expect(extractEnvEntries(patch)).toEqual([
			{ key: "FOO", value: "bar" },
			{ key: "BAZ", value: "qux" },
		]);
		expect(isEnvLikePatch(patch)).toBe(true);
		expect(isEnvLikePatch("change the Dockerfile FROM line")).toBe(false);
	});

	it("merges patch over existing dotenv", () => {
		expect(mergeDotenv("FOO=old\nKEEP=1", "FOO=new\nBAR=2")).toBe("FOO=new\nKEEP=1\nBAR=2");
	});
});
