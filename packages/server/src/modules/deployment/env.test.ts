import { describe, expect, it } from "vitest";
import { BUILD_WITH_RUNTIME_ENV, mergeEnv, parseEnv, resolveBuildEnv } from "./env";

describe("parseEnv / mergeEnv", () => {
	it("skips blanks and comments, later layers win by key", () => {
		expect(parseEnv("# c\n\nA=1\nB=x=y")).toEqual([
			["A", "1"],
			["B", "x=y"],
		]);
		expect(mergeEnv("A=1\nB=2", "B=3")).toBe("A=1\nB=3");
	});
});

describe("resolveBuildEnv", () => {
	const runtime = "DATABASE_URL=postgres://secret\nNODE_ENV=production";
	const buildArgs = "NEXT_PUBLIC_API=https://api\nNODE_ENV=build";

	it("hands only the build args to the builders by default", () => {
		expect(resolveBuildEnv(buildArgs, runtime, {})).toEqual([
			"NEXT_PUBLIC_API=https://api",
			"NODE_ENV=build",
		]);
		expect(resolveBuildEnv(null, runtime, {})).toEqual([]);
	});

	it("merges the runtime env under the build args with the escape hatch", () => {
		expect(resolveBuildEnv(buildArgs, runtime, { [BUILD_WITH_RUNTIME_ENV]: "1" })).toEqual([
			"DATABASE_URL=postgres://secret",
			"NODE_ENV=build",
			"NEXT_PUBLIC_API=https://api",
		]);
		expect(resolveBuildEnv(buildArgs, runtime, { [BUILD_WITH_RUNTIME_ENV]: "0" })).toEqual([
			"NEXT_PUBLIC_API=https://api",
			"NODE_ENV=build",
		]);
	});
});
