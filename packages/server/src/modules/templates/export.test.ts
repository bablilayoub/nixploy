import { describe, expect, it } from "vitest";
import { type ExportableCompose, exportComposeAsTemplate } from "./export";
import { remoteTemplateSchema } from "./schema";

const COMPOSE = `services:
  web:
    image: ghcr.io/acme/shop:1.4
    ports:
      - "8080:3000"
    environment:
      DATABASE_URL: \${DATABASE_URL}
  db:
    image: postgres:16
    volumes:
      - data:/var/lib/postgresql/data
volumes:
  data: {}
`;

const row: ExportableCompose = {
	name: "Shop",
	appName: "shop-a1b2c3",
	description: "The shop",
	composeFile: COMPOSE,
	sourceType: "raw",
	env: [
		"POSTGRES_PASSWORD=hunter2",
		"DATABASE_URL=postgres://shop:hunter2@db:5432/shop",
		"BASE_URL=https://shop.example.com/app",
		"PUBLIC_HOST=shop.example.com",
		"LOG_LEVEL=info",
		"# comment",
	].join("\n"),
	hostPrivileged: false,
};

describe("exportComposeAsTemplate", () => {
	it("produces a schema-valid template with secrets and hostnames rewritten", () => {
		const { template, notes } = exportComposeAsTemplate(row, [
			{ host: "shop.example.com", serviceName: "web", port: 3000, https: true },
		]);
		expect(remoteTemplateSchema.safeParse(template).success).toBe(true);
		expect(template.id).toBe("shop-a1b2c3");
		expect(template.compose).toBe(COMPOSE);
		expect(template.suggestedDomain).toEqual({ serviceName: "web", port: 3000 });
		expect(Object.fromEntries(template.env.map((entry) => [entry.key, entry.default]))).toEqual({
			POSTGRES_PASSWORD: "{{generateSecret}}",
			// URL-shaped keys are secret-shaped too (the credential rides inside).
			DATABASE_URL: "postgres://shop:hunter2@db:5432/shop",
			BASE_URL: "https://{{domain}}/app",
			PUBLIC_HOST: "{{domain}}",
			LOG_LEVEL: "info",
		});
		expect(notes).toEqual([
			"POSTGRES_PASSWORD: value replaced with {{generateSecret}}",
			"BASE_URL: https://shop.example.com/app → https://{{domain}}/app",
			"PUBLIC_HOST: shop.example.com → {{domain}}",
		]);
	});

	it("falls back to the first exposed port when nothing is routed", () => {
		const { template, notes } = exportComposeAsTemplate(row, []);
		expect(template.suggestedDomain).toEqual({ serviceName: "web", port: 3000 });
		expect(notes.at(-1)).toMatch(/no routed domain/);
	});

	it("refuses git-backed and host-privileged stacks", () => {
		expect(() => exportComposeAsTemplate({ ...row, sourceType: "git" }, [])).toThrow(/git-backed/);
		expect(() => exportComposeAsTemplate({ ...row, composeFile: "  " }, [])).toThrow(/raw source/);
		expect(() => exportComposeAsTemplate({ ...row, hostPrivileged: true }, [])).toThrow(
			/host-privileged/,
		);
	});
});
