import { describe, expect, it } from "vitest";

import { formatEnvValue, mergeEnvText, parseEnvFile, serializeEnvEntries } from "@/lib/env-file";

describe("parseEnvFile", () => {
	it("reads plain, exported and quoted assignments", () => {
		expect(
			parseEnvFile(
				[
					"# a comment",
					"",
					"PORT=3000",
					"export TOKEN=abc",
					'GREETING="hello\\nworld"',
					"LITERAL='raw \\n stays'",
					"  SPACED = trimmed  ",
				].join("\n"),
			),
		).toEqual([
			{ key: "PORT", value: "3000" },
			{ key: "TOKEN", value: "abc" },
			{ key: "GREETING", value: "hello\nworld" },
			{ key: "LITERAL", value: "raw \\n stays" },
			{ key: "SPACED", value: "trimmed" },
		]);
	});

	it("strips inline comments from unquoted values but not from quoted ones", () => {
		expect(parseEnvFile("URL=http://x  # the api")).toEqual([{ key: "URL", value: "http://x" }]);
		expect(parseEnvFile('NOTE="keep # this"')).toEqual([{ key: "NOTE", value: "keep # this" }]);
		// A `#` glued to the value is part of it — only ` #` ends the value.
		expect(parseEnvFile("HASH=a#b")).toEqual([{ key: "HASH", value: "a#b" }]);
	});

	it("skips malformed lines and lets later duplicates win", () => {
		expect(parseEnvFile(["no-equals", "=novalue", "1BAD=x", "A=1", "A=2"].join("\n"))).toEqual([
			{ key: "A", value: "2" },
		]);
	});

	it("accepts CRLF input", () => {
		expect(parseEnvFile("A=1\r\nB=2\r\n")).toEqual([
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
		]);
	});
});

describe("formatEnvValue", () => {
	it("quotes only what would not round-trip", () => {
		expect(formatEnvValue("plain")).toBe("plain");
		expect(formatEnvValue("http://x/y?z=1")).toBe("http://x/y?z=1");
		expect(formatEnvValue("")).toBe('""');
		expect(formatEnvValue("two words")).toBe('"two words"');
		expect(formatEnvValue("with#hash")).toBe('"with#hash"');
		expect(formatEnvValue("a\nb")).toBe('"a\\nb"');
		expect(formatEnvValue('say "hi"')).toBe('"say \\"hi\\""');
		expect(formatEnvValue("back\\slash")).toBe('"back\\\\slash"');
	});

	it("round-trips through the parser", () => {
		const value = 'multi line\nwith "quotes" and \\ and # and $VAR';
		expect(parseEnvFile(`K=${formatEnvValue(value)}`)).toEqual([{ key: "K", value }]);
	});
});

describe("mergeEnvText", () => {
	it("replaces known keys in place and appends the rest", () => {
		const draft = ["# config", "A=1", "", "B=2"].join("\n");
		expect(
			mergeEnvText(draft, [
				{ key: "B", value: "new" },
				{ key: "C", value: "3" },
			]),
		).toBe(["# config", "A=1", "", "B=new", "C=3"].join("\n"));
	});

	it("matches exported keys and keeps comments untouched", () => {
		expect(mergeEnvText("# keep\nexport A=1", [{ key: "A", value: "2" }])).toBe("# keep\nA=2");
	});

	it("returns the draft unchanged when nothing is imported", () => {
		expect(mergeEnvText("A=1", [])).toBe("A=1");
	});

	it("drops a single trailing blank line before appending", () => {
		expect(mergeEnvText("A=1\n", [{ key: "B", value: "2" }])).toBe("A=1\nB=2");
	});
});

describe("serializeEnvEntries", () => {
	it("writes one KEY=VALUE per line", () => {
		expect(
			serializeEnvEntries([
				{ key: "A", value: "1" },
				{ key: "B", value: "two words" },
			]),
		).toBe('A=1\nB="two words"');
		expect(serializeEnvEntries([])).toBe("");
	});
});
