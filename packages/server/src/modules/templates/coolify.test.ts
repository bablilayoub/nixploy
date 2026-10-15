import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { renderComposeSpec } from "../compose/interpolate";
import { parseComposeFile } from "../compose/parse";
import { parseCoolifyCatalog } from "./coolify";
import { resolveTemplateEnv } from "./placeholders";
import { checkTemplateCompose, templateNeedsInstanceAdmin } from "./safety";
import { MAX_TEMPLATE_COMPOSE_BYTES, MAX_TEMPLATES_PER_SOURCE } from "./schema";

const ref = (key: string): string => `\${${key}}`;
const entry = (compose: string, overrides: Record<string, unknown> = {}) => ({
	compose: Buffer.from(compose).toString("base64"),
	documentation: "https://example.com/docs",
	slogan: "A service with persistent data.",
	tags: ["analytics"],
	category: "analytics",
	logo: "svgs/example.svg",
	port: "3000",
	...overrides,
});

const webDatabase = `services:
  my-api:
    image: example/api:1.0
    environment:
      - SERVICE_URL_MY_API_3000
      - PUBLIC_URL=${ref("SERVICE_URL_MY_API_3000")}
      - HOST=${ref("SERVICE_FQDN_MY_API")}
      - DATABASE_URL=postgres://${ref("SERVICE_USER_DB")}:${ref("SERVICE_PASSWORD_64_DB")}@db:5432/${ref("DB_NAME:-app")}
      - API_KEY=${ref("API_KEY:?")}
      - PORT=${ref("PORT:?8080")}
      - SELF=${ref("SERVICE_NAME_MY_API")}
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${ref("SERVICE_USER_DB")}
      POSTGRES_PASSWORD: ${ref("SERVICE_PASSWORD_64_DB")}
      POSTGRES_DB: ${ref("DB_NAME:-app")}
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U $${ref("POSTGRES_USER")}']
`;

describe("parseCoolifyCatalog", () => {
	it("translates public service targeting, defaults, required inputs and omitted named volumes", () => {
		const result = parseCoolifyCatalog({ example: entry(webDatabase) });
		expect(result.rejected).toEqual([]);
		const template = result.templates[0];
		expect(template).toMatchObject({
			id: "example",
			name: "Example",
			category: "Analytics",
			requiresDomain: true,
			suggestedDomain: { serviceName: "my-api", port: 3000 },
		});
		expect(template?.env).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ key: "SERVICE_URL_MY_API_3000", default: "http://{{domain}}" }),
				expect.objectContaining({ key: "SERVICE_FQDN_MY_API", default: "{{domain}}" }),
				expect.objectContaining({ key: "SERVICE_NAME_MY_API", default: "my-api" }),
				expect.objectContaining({ key: "DB_NAME", default: "app" }),
				expect.objectContaining({ key: "API_KEY", default: "", required: true }),
				expect.objectContaining({ key: "PORT", default: "", required: true }),
			]),
		);
		expect(template?.env.some((item) => item.key === "POSTGRES_USER")).toBe(false);
		const spec = parseYaml(template?.compose ?? "");
		expect(spec.volumes).toEqual({ "db-data": {} });
		expect(spec.services["my-api"].environment).toContain(
			`SERVICE_URL_MY_API_3000=${ref("SERVICE_URL_MY_API_3000")}`,
		);
		expect(spec.services.db.healthcheck.test[1]).toContain(`$${ref("POSTGRES_USER")}`);
		expect(() => checkTemplateCompose(template?.compose ?? "")).not.toThrow();
	});

	it("produces no secrets at sync, reuses complete variable identities and creates fresh install credentials", () => {
		const first = parseCoolifyCatalog({ example: entry(webDatabase) }).templates[0];
		const second = parseCoolifyCatalog({ example: entry(webDatabase) }).templates[0];
		expect(first).toEqual(second);
		const entries = first?.env.map((item) => ({ key: item.key, value: item.default })) ?? [];
		const a = resolveTemplateEnv(entries, { domain: "app.example.com" });
		const b = resolveTemplateEnv(entries, { domain: "other.example.com" });
		expect(a.SERVICE_USER_DB).toMatch(/^[A-Za-z0-9]{16}$/);
		expect(a.SERVICE_PASSWORD_64_DB).toMatch(/^[A-Za-z0-9]{64}$/);
		expect(a.SERVICE_PASSWORD_64_DB).not.toBe(b.SERVICE_PASSWORD_64_DB);
		expect(a.SERVICE_URL_MY_API_3000).toBe("http://app.example.com");
		expect(a.SERVICE_FQDN_MY_API).toBe("app.example.com");
		// The compose body refers to the same two env keys in both components;
		// ordinary redeploys use these stored values without resolving again.
		expect(first?.compose.match(/SERVICE_PASSWORD_64_DB/g)).toHaveLength(2);
	});

	it.each([false, true])(
		"keeps required diagnostic text out of defaults regardless of reference order (%s)",
		(requiredFirst) => {
			const references = [
				`REQUIRED: ${ref("DB_PASSWORD:?Supply a strong password")}`,
				`PLAIN: ${ref("DB_PASSWORD")}`,
				`OPTIONAL: ${ref("DB_PASSWORD:-optional-fallback")}`,
			];
			if (!requiredFirst) references.reverse();
			const result = parseCoolifyCatalog({
				required: entry(
					`services:\n  app:\n    image: example/app:1\n    environment:\n${references.map((line) => `      ${line}`).join("\n")}\n`,
				),
			});
			expect(result.rejected).toEqual([]);
			const template = result.templates[0];
			expect(template?.env).toEqual([
				{
					key: "DB_PASSWORD",
					default: "",
					description: "Supply a strong password",
					required: true,
				},
			]);
			const spec = parseComposeFile(template?.compose ?? "");
			expect(spec.services?.app?.environment).toMatchObject({
				REQUIRED: ref("DB_PASSWORD:?Supply a strong password"),
			});
			const missingValues: Record<string, string>[] = [{}, { DB_PASSWORD: "" }];
			for (const values of missingValues) {
				expect(() => renderComposeSpec(spec, values)).toThrow(
					/Required compose variable DB_PASSWORD.*Supply a strong password/,
				);
			}
			expect(
				renderComposeSpec(spec, { DB_PASSWORD: "chosen-password" }).services?.app?.environment,
			).toEqual({
				REQUIRED: "chosen-password",
				PLAIN: "chosen-password",
				OPTIONAL: "chosen-password",
			});
		},
	);

	it("keeps automatic generation for repeated required magic references", () => {
		const key = "SERVICE_PASSWORD_DB";
		const result = parseCoolifyCatalog({
			required: entry(
				`services:\n  app:\n    image: example/app:1\n    environment:\n      REQUIRED: ${ref(`${key}:?Supply a strong password`)}\n      PLAIN: ${ref(key)}\n`,
			),
		});
		expect(result.rejected).toEqual([]);
		const template = result.templates[0];
		expect(template?.env).toHaveLength(1);
		expect(template?.env[0]).toMatchObject({ key, required: true });
		const values = resolveTemplateEnv(
			template?.env.map((item) => ({ key: item.key, value: item.default })) ?? [],
		);
		expect(values[key]).toMatch(/^[A-Za-z0-9]{32}$/);
		expect(
			renderComposeSpec(parseComposeFile(template?.compose ?? ""), values).services?.app
				?.environment,
		).toEqual({ REQUIRED: values[key], PLAIN: values[key] });
	});

	it.each<{ input: Record<string, string>; expected: Record<string, string> }>([
		{ input: {}, expected: { UNSET_ONLY: "fallback", EMPTY_TOO: "fallback" } },
		{ input: { EXAMPLE: "" }, expected: { UNSET_ONLY: "", EMPTY_TOO: "fallback" } },
		{ input: { EXAMPLE: "chosen" }, expected: { UNSET_ONLY: "chosen", EMPTY_TOO: "chosen" } },
	])("retains default-operator behavior for input $input", ({ input, expected }) => {
		const raw = `services:\n  app:\n    image: example/app:1\n    environment:\n      UNSET_ONLY: ${ref("EXAMPLE-fallback")}\n      EMPTY_TOO: ${ref("EXAMPLE:-fallback")}\n`;
		const result = parseCoolifyCatalog({ defaults: entry(raw) });
		expect(result.rejected).toEqual([]);
		const translated = parseComposeFile(result.templates[0]?.compose ?? "");
		expect(translated.services?.app?.environment).toEqual({
			UNSET_ONLY: ref("EXAMPLE-fallback"),
			EMPTY_TOO: ref("EXAMPLE:-fallback"),
		});
		expect(renderComposeSpec(translated, input).services?.app?.environment).toEqual(expected);
		expect(renderComposeSpec(parseComposeFile(raw), input).services?.app?.environment).toEqual(
			expected,
		);
	});

	it("retains default operators around repeated generated references", () => {
		const key = "SERVICE_PASSWORD_64_DB";
		const result = parseCoolifyCatalog({
			generated: entry(
				`services:\n  app:\n    image: example/app:1\n    environment:\n      UNSET_ONLY: ${ref(`${key}-fallback`)}\n      EMPTY_TOO: ${ref(`${key}:-fallback`)}\n      DIRECT: ${ref(key)}\n`,
			),
		});
		expect(result.rejected).toEqual([]);
		const template = result.templates[0];
		expect(template?.env.filter((item) => item.key === key)).toHaveLength(1);
		const spec = parseComposeFile(template?.compose ?? "");
		const values = resolveTemplateEnv(
			template?.env.map((item) => ({ key: item.key, value: item.default })) ?? [],
		);
		expect(values[key]).toMatch(/^[A-Za-z0-9]{64}$/);
		expect(renderComposeSpec(spec, values).services?.app?.environment).toEqual({
			UNSET_ONLY: values[key],
			EMPTY_TOO: values[key],
			DIRECT: values[key],
		});
		expect(renderComposeSpec(spec, {}).services?.app?.environment).toEqual({
			UNSET_ONLY: "fallback",
			EMPTY_TOO: "fallback",
			DIRECT: "",
		});
		expect(renderComposeSpec(spec, { [key]: "" }).services?.app?.environment).toEqual({
			UNSET_ONLY: "",
			EMPTY_TOO: "fallback",
			DIRECT: "",
		});
	});

	it.each(["EXAMPLE:+alternate", "EXAMPLE+alternate", "EXAMPLE?message"])(
		"keeps unsupported interpolation %s rejected",
		(expression) => {
			const result = parseCoolifyCatalog({
				unsupported: entry(
					`services:\n  app:\n    image: example/app:1\n    environment:\n      VALUE: ${ref(expression)}\n`,
				),
			});
			expect(result.templates).toEqual([]);
			expect(result.rejected[0]).toMatch(/unsupported Compose interpolation/);
		},
	);

	it("supports documented random types without confusing BASE64 with REALBASE64", () => {
		const keys = [
			"SERVICE_BASE64_TOKEN",
			"SERVICE_BASE64_32_TOKEN",
			"SERVICE_BASE64_64_TOKEN",
			"SERVICE_BASE64_128_TOKEN",
			"SERVICE_REALBASE64_TOKEN",
			"SERVICE_REALBASE64_64_TOKEN",
			"SERVICE_REALBASE64_128_TOKEN",
			"SERVICE_HEX_32_TOKEN",
			"SERVICE_HEX_64_TOKEN",
			"SERVICE_HEX_128_TOKEN",
			"SERVICE_LOWERCASEUSER_TOKEN",
			"SERVICE_PASSWORDWITHSYMBOLS_64_TOKEN",
		];
		const result = parseCoolifyCatalog({
			generators: entry(
				`services:\n  app:\n    image: example/app:1\n    environment:\n${keys.map((key) => `      - ${key}=${ref(key)}`).join("\n")}\n`,
			),
		});
		expect(result.rejected).toEqual([]);
		const resolved = resolveTemplateEnv(
			result.templates[0]?.env.map((item) => ({ key: item.key, value: item.default })) ?? [],
		);
		for (const size of [32, 64, 128]) {
			expect(resolved[`SERVICE_BASE64_${size}_TOKEN`]).toMatch(
				new RegExp(`^[A-Za-z0-9]{${size}}$`),
			);
			expect(resolved[`SERVICE_HEX_${size}_TOKEN`]).toMatch(new RegExp(`^[a-f0-9]{${size}}$`));
		}
		expect(resolved.SERVICE_BASE64_TOKEN).toMatch(/^[A-Za-z0-9]{32}$/);
		expect(resolved.SERVICE_BASE64_TOKEN).not.toBe(resolved.SERVICE_BASE64_32_TOKEN);
		for (const size of [64, 128]) {
			expect(
				Buffer.from(resolved[`SERVICE_REALBASE64_${size}_TOKEN`] ?? "", "base64"),
			).toHaveLength(size);
		}
		expect(Buffer.from(resolved.SERVICE_REALBASE64_TOKEN ?? "", "base64")).toHaveLength(32);
		expect(resolved.SERVICE_LOWERCASEUSER_TOKEN).toMatch(/^[a-z0-9]{16}$/);
		expect(resolved.SERVICE_PASSWORDWITHSYMBOLS_64_TOKEN).toHaveLength(64);
	});

	it("accepts unambiguous legacy aliases found in the official catalog", () => {
		const result = parseCoolifyCatalog({
			"uptime-kuma": entry(
				"services:\n  uptime-kuma:\n    image: louislam/uptime-kuma:2\n    environment:\n      - SERVICE_FQDN_UPTIMEKUMA_3001\n",
			),
		});
		expect(result.rejected).toEqual([]);
		expect(result.templates[0]?.suggestedDomain).toEqual({
			serviceName: "uptime-kuma",
			port: 3001,
		});
	});

	it.each([
		["unknown magic", "SERVICE_RANDOM_TOKEN", /unsupported magic variable/],
		["unsupported size", "SERVICE_PASSWORD_128_TOKEN", /unsupported generator size/],
		[
			"ambiguous generator identifier",
			"SERVICE_PASSWORD_DB_PASSWORD",
			/unsupported magic variable/,
		],
		["Supabase signing", "SERVICE_SUPABASEANON_KEY", /unsupported magic variable/],
		["unknown target", "SERVICE_FQDN_OTHER", /does not identify one service/],
		["invalid target port", "SERVICE_URL_APP_65536", /invalid internal port/],
		["missing generator identifier", "SERVICE_REALBASE64_128", /ambiguous generator name/],
	])("rejects %s instead of guessing", (_label, key, reason) => {
		const result = parseCoolifyCatalog({
			bad: entry(
				`services:\n  app:\n    image: example/app:1\n    environment:\n      - VALUE=${ref(String(key))}\n`,
			),
		});
		expect(result.templates).toHaveLength(0);
		expect(result.rejected[0]).toMatch(reason as RegExp);
	});

	it.each([
		[
			"paths",
			"services:\n  app:\n    image: example/app:1\n    environment:\n      SERVICE_URL_APP_3000: /v1\n",
			/paths or overrides/,
		],
		[
			"multiple targets",
			"services:\n  app:\n    image: example/app:1\n    environment: [SERVICE_URL_APP_3000]\n  admin:\n    image: example/admin:1\n    environment: [SERVICE_URL_ADMIN_3001]\n",
			/multiple public service targets/,
		],
		[
			"inline files",
			"services:\n  app:\n    image: example/app:1\n    volumes:\n      - type: bind\n        source: ./config\n        target: /config\n        content: secret\n",
			/file-content mounts/,
		],
		[
			"health exclusions",
			"services:\n  app:\n    image: example/app:1\n    exclude_from_hc: true\n",
			/exclude_from_hc/,
		],
		[
			"conflicting defaults",
			`services:\n  app:\n    image: example/app:1\n    environment:\n      - A=${ref("KEY:-one")}\n      - B=${ref("KEY:-two")}\n`,
			/conflicting defaults/,
		],
		[
			"nested defaults",
			`services:\n  app:\n    image: example/app:1\n    environment:\n      A: ${ref(`KEY:-${ref("OTHER")}`)}\n`,
			/nested Compose interpolation/,
		],
		[
			"cyclic YAML",
			"services:\n  app: &app\n    image: example/app:1\n    extra: *app\n",
			/cyclic or deeply nested/,
		],
	])("reports unsupported %s per entry and retains a valid sibling", (_label, compose, reason) => {
		const result = parseCoolifyCatalog({
			bad: entry(String(compose)),
			good: entry("services:\n  app:\n    image: example/app:1\n"),
		});
		expect(result.templates.map((item) => item.id)).toEqual(["good"]);
		expect(result.rejected[0]).toMatch(reason as RegExp);
	});

	it("keeps ordinary host mount and port checks at the shared safety boundary", () => {
		const result = parseCoolifyCatalog({
			socket: entry(
				"services:\n  app:\n    image: example/app:1\n    volumes: [/var/run/docker.sock:/var/run/docker.sock]\n",
				{ hostPrivileged: true },
			),
			ported: entry('services:\n  app:\n    image: example/app:1\n    ports: ["8080:80"]\n'),
		});
		expect(result.rejected).toEqual([]);
		expect(() => checkTemplateCompose(result.templates[0]?.compose ?? "")).toThrow(/Docker socket/);
		expect(result.templates[0]?.hostPrivileged).toBeUndefined();
		expect(templateNeedsInstanceAdmin(result.templates[1] ?? { compose: "" })).toBe(true);
	});

	it("bounds the index and validates Base64 bytes before YAML", () => {
		expect(() => parseCoolifyCatalog([])).toThrow(/object keyed by template id/);
		expect(() =>
			parseCoolifyCatalog(
				Object.fromEntries(
					Array.from({ length: MAX_TEMPLATES_PER_SOURCE + 1 }, (_, index) => [`t${index}`, {}]),
				),
			),
		).toThrow(/exceeds/);
		const result = parseCoolifyCatalog({
			invalid: entry("", { compose: "not base64" }),
			utf8: entry("", { compose: Buffer.from([255, 254]).toString("base64") }),
			large: entry("x".repeat(MAX_TEMPLATE_COMPOSE_BYTES + 1)),
		});
		expect(result.templates).toEqual([]);
		expect(result.rejected).toHaveLength(3);
		expect(result.rejected[0]).toMatch(/Base64/);
		expect(result.rejected[1]).toMatch(/UTF-8/);
	});
});
