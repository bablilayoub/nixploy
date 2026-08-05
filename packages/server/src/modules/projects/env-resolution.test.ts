import { describe, expect, it } from "vitest";
import { mergeEnv, mergeEnvStrings, parseEnv, toEnvString } from "./env-resolution";

describe("parseEnv", () => {
	it("parses simple KEY=VALUE lines", () => {
		expect(parseEnv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
	});

	it("returns an empty map for null/undefined/empty input", () => {
		expect(parseEnv(null)).toEqual({});
		expect(parseEnv(undefined)).toEqual({});
		expect(parseEnv("")).toEqual({});
		expect(parseEnv("\n  \n")).toEqual({});
	});

	it("skips comments and blank lines", () => {
		expect(parseEnv("# comment\nA=1\n\n   \n#B=2")).toEqual({ A: "1" });
	});

	it("supports the `export ` prefix", () => {
		expect(parseEnv("export A=1")).toEqual({ A: "1" });
	});

	it("handles CRLF line endings", () => {
		expect(parseEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
	});

	it("strips double quotes and expands escape sequences", () => {
		expect(parseEnv('A="hello world"')).toEqual({ A: "hello world" });
		expect(parseEnv('B="line\\nbreak\\t!"')).toEqual({ B: "line\nbreak\t!" });
		expect(parseEnv('C="say \\"hi\\""')).toEqual({ C: 'say "hi"' });
	});

	it("strips single quotes without expanding escapes", () => {
		expect(parseEnv("A='hello world'")).toEqual({ A: "hello world" });
		expect(parseEnv("B='no\\nescape'")).toEqual({ B: "no\\nescape" });
	});

	it("strips inline comments on unquoted values only", () => {
		expect(parseEnv("A=value # trailing comment")).toEqual({ A: "value" });
		expect(parseEnv('B="value # not a comment"')).toEqual({ B: "value # not a comment" });
		expect(parseEnv("C=hash#inside")).toEqual({ C: "hash#inside" });
	});

	it("treats a key without `=` as an empty value", () => {
		expect(parseEnv("EMPTY\nA=1")).toEqual({ EMPTY: "", A: "1" });
		expect(parseEnv("ALSO_EMPTY=")).toEqual({ ALSO_EMPTY: "" });
	});

	it("keeps `=` inside values", () => {
		expect(parseEnv("URL=postgres://u:p@host/db?x=1")).toEqual({
			URL: "postgres://u:p@host/db?x=1",
		});
	});

	it("skips malformed lines and invalid keys", () => {
		expect(parseEnv("=novalue\n1 BAD=x\nGOOD=1\nKEY WITH SPACE=2")).toEqual({ GOOD: "1" });
	});

	it("later lines win on duplicate keys", () => {
		expect(parseEnv("A=1\nA=2")).toEqual({ A: "2" });
	});
});

describe("mergeEnv / mergeEnvStrings", () => {
	it("override wins over base", () => {
		expect(mergeEnv({ A: "1", B: "2" }, { B: "3", C: "4" })).toEqual({
			A: "1",
			B: "3",
			C: "4",
		});
	});

	it("empty-string values are legitimate overrides (unset a base value)", () => {
		expect(mergeEnv({ A: "secret" }, { A: "" })).toEqual({ A: "" });
	});

	it("applies organization < project < environment precedence", () => {
		// Mirrors resolveEnvironmentVariables: org metadata → project.env → environment.env.
		const org = "SHARED=org\nORG_ONLY=1\nLEVEL=org";
		const project = "SHARED=project\nPROJECT_ONLY=1\nLEVEL=project";
		const environment = "SHARED=environment\nLEVEL=environment";
		const merged = mergeEnv(mergeEnvStrings(org, project), parseEnv(environment));
		expect(merged).toEqual({
			SHARED: "environment",
			ORG_ONLY: "1",
			PROJECT_ONLY: "1",
			LEVEL: "environment",
		});
	});

	it("handles missing levels in the chain", () => {
		expect(mergeEnvStrings(null, "A=1")).toEqual({ A: "1" });
		expect(mergeEnvStrings("A=1", undefined)).toEqual({ A: "1" });
		expect(mergeEnvStrings(null, null)).toEqual({});
	});
});

describe("toEnvString", () => {
	it("serializes plain values bare and quotes values needing it", () => {
		expect(toEnvString({ A: "1", B: "has space", C: "" })).toBe('A=1\nB="has space"\nC=""');
	});

	it("round-trips through parseEnv", () => {
		const vars = {
			PLAIN: "value",
			SPACES: "a b c",
			QUOTE: 'say "hi"',
			NEWLINE: "line1\nline2",
			EMPTY: "",
			HASH: "a # b",
		};
		expect(parseEnv(toEnvString(vars))).toEqual(vars);
	});
});
