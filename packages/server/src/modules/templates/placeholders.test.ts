import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasPlaceholders, resolveTemplateEnv, signJwtHs256 } from "./placeholders";

describe("resolveTemplateEnv", () => {
	it("keeps the legacy generateSecret fresh per occurrence", () => {
		const out = resolveTemplateEnv([
			{ key: "A", value: "{{generateSecret}}" },
			{ key: "B", value: "{{generateSecret}}" },
		]);
		expect(out.A).toMatch(/^[0-9a-f]{48}$/);
		expect(out.B).toMatch(/^[0-9a-f]{48}$/);
		expect(out.A).not.toBe(out.B);
	});

	it("generates a named value once and reuses it across keys", () => {
		const out = resolveTemplateEnv([
			{ key: "POSTGRES_PASSWORD", value: "{{generatePassword:32:db}}" },
			{ key: "DATABASE_URL", value: "postgres://shop:{{generatePassword:32:db}}@db:5432/shop" },
			{ key: "OTHER", value: "{{generatePassword:32:other}}" },
		]);
		expect(out.POSTGRES_PASSWORD).toMatch(/^[A-Za-z0-9]{32}$/);
		expect(out.DATABASE_URL).toBe(`postgres://shop:${out.POSTGRES_PASSWORD}@db:5432/shop`);
		expect(out.OTHER).not.toBe(out.POSTGRES_PASSWORD);
	});

	it("honours the length and shape of each generator", () => {
		const out = resolveTemplateEnv([
			{ key: "B64", value: "{{generateBase64:64:x}}" },
			{ key: "HEX", value: "{{generateHash:16:y}}" },
			{ key: "UUID", value: "{{generateUuid:z}}" },
			{ key: "PASS", value: "{{generatePassword:8}}" },
		]);
		expect(Buffer.from(out.B64 ?? "", "base64")).toHaveLength(64);
		expect(out.HEX).toMatch(/^[0-9a-f]{16}$/);
		expect(out.UUID).toMatch(/^[0-9a-f-]{36}$/);
		expect(out.PASS).toMatch(/^[A-Za-z0-9]{8}$/);
	});

	it("substitutes the attached domain and falls back to localhost", () => {
		expect(
			resolveTemplateEnv([{ key: "URL", value: "https://{{domain}}/x" }], {
				domain: "a.example.com",
			}).URL,
		).toBe("https://a.example.com/x");
		expect(resolveTemplateEnv([{ key: "URL", value: "http://{{domain}}" }]).URL).toBe(
			"http://localhost",
		);
	});

	it("signs a JWT with a named secret and the encoded payload", () => {
		const payload = Buffer.from(JSON.stringify({ role: "anon", exp: 1893456000 })).toString(
			"base64url",
		);
		const out = resolveTemplateEnv([
			{ key: "JWT_SECRET", value: "{{generatePassword:32:jwt_secret}}" },
			{ key: "ANON_KEY", value: `{{generateJwt:jwt_secret:${payload}}}` },
		]);
		const [header, body, signature] = (out.ANON_KEY ?? "").split(".");
		expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
			alg: "HS256",
			typ: "JWT",
		});
		expect(JSON.parse(Buffer.from(body ?? "", "base64url").toString())).toEqual({
			role: "anon",
			exp: 1893456000,
		});
		const expected = createHmac("sha256", out.JWT_SECRET ?? "")
			.update(`${header}.${body}`)
			.digest("base64url");
		expect(signature).toBe(expected);
		expect(signJwtHs256("s", { a: 1 }).split(".")).toHaveLength(3);
	});

	it("resolves references between keys, after the generators, without spinning on a cycle", () => {
		const out = resolveTemplateEnv(
			[
				{ key: "HOST", value: "{{domain}}" },
				{ key: "PASS", value: "{{generatePassword:12:p}}" },
				{ key: "URL", value: "https://{{env:HOST}}/?k={{env:PASS}}" },
				{ key: "LOOP_A", value: "{{env:LOOP_B}}" },
				{ key: "LOOP_B", value: "{{env:LOOP_A}}" },
			],
			{ domain: "h.example.com" },
		);
		expect(out.URL).toBe(`https://h.example.com/?k=${out.PASS}`);
		expect(out.LOOP_A).toContain("{{env:");
	});

	it("leaves unknown placeholders and plain values alone", () => {
		const out = resolveTemplateEnv([
			{ key: "A", value: "{{generateNothing}}" },
			{ key: "B", value: `plain $${"{"}SHELL_STYLE}` },
		]);
		expect(out.A).toBe("{{generateNothing}}");
		expect(out.B).toBe(`plain $${"{"}SHELL_STYLE}`);
		expect(hasPlaceholders("x {{domain}}")).toBe(true);
		expect(hasPlaceholders(`x $${"{"}VAR}`)).toBe(false);
	});
});
