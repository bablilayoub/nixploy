import { renderComposeSpec } from "@nixploy/server/modules/compose/interpolate";
import { parseComposeFile } from "@nixploy/server/modules/compose/parse";
import { resolveTemplateEnv } from "@nixploy/server/modules/templates/placeholders";
import { describe, expect, it } from "vitest";
import { templateEnvInputs } from "./template-env-inputs";

describe("template environment inputs", () => {
	it("preserves cleared ordinary fields through server defaults and both Compose operators", () => {
		const entries = [{ key: "EXAMPLE", default: "fallback" }];
		const { provided } = templateEnvInputs(entries, { EXAMPLE: "" });
		expect(provided).toEqual({ EXAMPLE: "" });
		const env = resolveTemplateEnv(
			entries.map((entry) => ({ key: entry.key, value: provided[entry.key] ?? entry.default })),
		);
		const spec = parseComposeFile(
			`services:
  app:
    image: example/app:1
    environment:
      UNSET_ONLY: \${EXAMPLE-fallback}
      EMPTY_TOO: \${EXAMPLE:-fallback}
`,
		);
		expect(renderComposeSpec(spec, env).services?.app?.environment).toEqual({
			UNSET_ONLY: "",
			EMPTY_TOO: "fallback",
		});
	});

	it("retains omitted ordinary defaults and supplied values exactly", () => {
		const entries = [
			{ key: "DEFAULT", default: "fallback", required: true },
			{ key: "VALUE", default: "" },
		];
		expect(templateEnvInputs(entries, { VALUE: " chosen = value " })).toEqual({
			provided: { VALUE: " chosen = value " },
			missingRequired: [],
		});
	});

	it("omits blank automatic fields and keeps generation fresh for each installation", () => {
		const entries = [
			{ key: "SECRET", default: "{{generatePassword:32:secret}}", required: true },
			{ key: "HOST", default: "{{domain}}" },
			{ key: "COPY", default: "{{env:SECRET}}" },
		];
		const { provided, missingRequired } = templateEnvInputs(entries, {
			SECRET: "",
			HOST: "",
			COPY: "",
		});
		expect(provided).toEqual({});
		expect(missingRequired).toEqual([]);
		const inputs = entries.map((entry) => ({
			key: entry.key,
			value: provided[entry.key] ?? entry.default,
		}));
		const first = resolveTemplateEnv(inputs, { domain: "example.test" });
		const second = resolveTemplateEnv(inputs, { domain: "example.test" });
		expect(first.SECRET).toMatch(/^[A-Za-z0-9]{32}$/);
		expect(first.SECRET).not.toBe(second.SECRET);
		expect(first.COPY).toBe(first.SECRET);
		expect(first.HOST).toBe("example.test");
	});

	it("keeps explicit automatic-field overrides", () => {
		expect(
			templateEnvInputs([{ key: "SECRET", default: "{{generatePassword:32:secret}}" }], {
				SECRET: "chosen",
			}).provided,
		).toEqual({ SECRET: "chosen" });
	});

	it.each(["", "   "])(
		"rejects a required ordinary value cleared to %j despite its nonempty default",
		(value) => {
			const entry = { key: "REQUIRED", default: "preset", required: true };
			expect(templateEnvInputs([entry], { REQUIRED: value })).toEqual({
				provided: { REQUIRED: value },
				missingRequired: [entry],
			});
		},
	);
});
