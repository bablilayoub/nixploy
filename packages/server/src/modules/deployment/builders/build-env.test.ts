import { describe, expect, it } from "vitest";
import {
	envNames,
	isSecretBuildArgKey,
	renderEnvFile,
	renderShellEnvFile,
	splitEnvEntry,
} from "./build-env";

describe("splitEnvEntry", () => {
	it("splits on the first '=' and keeps the rest verbatim", () => {
		expect(splitEnvEntry("A=b=c")).toEqual(["A", "b=c"]);
		expect(splitEnvEntry("EMPTY=")).toEqual(["EMPTY", ""]);
	});

	it("drops entries that are not valid env assignments", () => {
		expect(splitEnvEntry("=value")).toBe(null);
		expect(splitEnvEntry("NOEQUALS")).toBe(null);
		expect(splitEnvEntry("bad-key=1")).toBe(null);
		expect(splitEnvEntry("1BAD=1")).toBe(null);
	});
});

describe("renderEnvFile", () => {
	it("writes docker's KEY=VALUE format and flattens newlines", () => {
		expect(renderEnvFile(["A=1", "B=two words", "C=line1\nline2"])).toBe(
			"A=1\nB=two words\nC=line1 line2\n",
		);
	});

	it("is empty when nothing is passable", () => {
		expect(renderEnvFile([])).toBe("");
		expect(renderEnvFile(["bogus"])).toBe("");
	});
});

describe("renderShellEnvFile", () => {
	it("quotes values so `. file` cannot execute them", () => {
		expect(renderShellEnvFile(["A=two words"])).toBe("A='two words'\n");
		expect(renderShellEnvFile(["A=$(id)"])).toBe("A='$(id)'\n");
		expect(renderShellEnvFile(["A=it's"])).toContain("A='it'");
	});
});

describe("envNames", () => {
	it("returns only the names (values never reach argv)", () => {
		expect(envNames(["A=secret", "B=2", "bogus"])).toEqual(["A", "B"]);
	});
});

describe("isSecretBuildArgKey", () => {
	it("flags credential-shaped keys", () => {
		for (const key of ["API_KEY", "db_password", "STRIPE_SECRET", "GH_TOKEN", "JWT_PRIVATE"]) {
			expect(isSecretBuildArgKey(key)).toBe(true);
		}
	});

	it("leaves ordinary build args alone", () => {
		for (const key of ["NODE_ENV", "VERSION", "BUILD_NUMBER", "PORT"]) {
			expect(isSecretBuildArgKey(key)).toBe(false);
		}
	});
});
