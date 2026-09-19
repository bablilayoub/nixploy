import { describe, expect, it } from "vitest";
import { parseToml, TomlError } from "./toml";

/** `${name}` spelled so the linter does not read it as a template literal. */
const ref = (name: string): string => `$${"{"}${name}}`;

describe("parseToml", () => {
	it("reads the blueprint shape: variables, tables, arrays of tables, dotted tables", () => {
		const parsed = parseToml(`
# a comment
[variables]
main_domain = "\${domain}"
db_password = "\${password}"
db_user = "immich"

[config]
env = [
  "DB_HOSTNAME=immich-database",
  "DB_PORT=5432", # trailing comment
  "TZ=UTC",
]
mounts = []

[[config.domains]]
serviceName = "immich-server"
port = 2_283
host = "\${main_domain}"

[[config.domains]]
serviceName = "other"
port = 80
host = "x"
`);
		expect(parsed.variables).toEqual({
			main_domain: ref("domain"),
			db_password: ref("password"),
			db_user: "immich",
		});
		const config = parsed.config as Record<string, unknown>;
		expect(config.env).toEqual(["DB_HOSTNAME=immich-database", "DB_PORT=5432", "TZ=UTC"]);
		expect(config.mounts).toEqual([]);
		expect(config.domains).toEqual([
			{ serviceName: "immich-server", port: 2283, host: ref("main_domain") },
			{ serviceName: "other", port: 80, host: "x" },
		]);
	});

	it("reads the env table form", () => {
		const parsed = parseToml(
			`[config]\nmounts = []\n[config.env]\nN8N_HOST = "\${main_domain}"\nN8N_PORT = "5678"\n`,
		);
		expect((parsed.config as Record<string, unknown>).env).toEqual({
			N8N_HOST: ref("main_domain"),
			N8N_PORT: "5678",
		});
	});

	it("reads an env array declared before the table it lives in", () => {
		const parsed = parseToml(
			`[config]\nenv = ["A=1", "B=2"]\n[[config.domains]]\nserviceName = "a"\nport = 1\nhost = "h"\n`,
		);
		expect((parsed.config as Record<string, unknown>).env).toEqual(["A=1", "B=2"]);
	});

	it("reads multi-line basic strings with their first newline trimmed", () => {
		const parsed = parseToml(`[[config.mounts]]
filePath = "/a.xml"
content = """
<a>
  <b/>
</a>
"""
[variables]
payload = """{
  "role": "anon",
  "exp": \${timestamps:2030-01-01T00:00:00Z}
}
"""
`);
		const mounts = (parsed.config as Record<string, unknown>).mounts as Array<
			Record<string, string>
		>;
		expect(mounts[0]?.content).toBe("<a>\n  <b/>\n</a>\n");
		expect((parsed.variables as Record<string, string>).payload).toBe(
			`{\n  "role": "anon",\n  "exp": ${ref("timestamps:2030-01-01T00:00:00Z")}\n}\n`,
		);
	});

	it("reads escapes, literal strings, numbers with underscores, floats and booleans", () => {
		const parsed = parseToml(
			`a = "tab\\tquote\\" end"\nb = 'C:\\path'\nc = 8_000\nd = 1.5\ne = true\nf = -3\n`,
		);
		expect(parsed).toEqual({
			a: 'tab\tquote" end',
			b: "C:\\path",
			c: 8000,
			d: 1.5,
			e: true,
			f: -3,
		});
	});

	it("reads inline tables, empty or nested, and keeps escapes it does not know", () => {
		expect(parseToml('a = { b = 1, c = "x", d = { e = true } }\nenv = {}\n')).toEqual({
			a: { b: 1, c: "x", d: { e: true } },
			env: {},
		});
		expect(parseToml('s = "cost \\$5"')).toEqual({ s: "cost \\$5" });
	});

	it("refuses what it does not support instead of misreading it", () => {
		expect(() => parseToml("a =")).toThrow(TomlError);
		expect(() => parseToml('a = "unterminated')).toThrow(/unterminated/);
		expect(() => parseToml("a = 1\na = 2")).toThrow(/duplicate/);
		expect(() => parseToml("a = 2020-01-01")).toThrow(/unsupported value/);
		expect(() => parseToml("[x]\ny = 1\n[x.y]\nz = 2")).toThrow(/is a value, not a table/);
	});
});
