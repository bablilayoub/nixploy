import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCoolifyCatalog } from "./coolify";
import type { Template } from "./types";

const { createCompose, updateComposeById, findTemplateById } = vi.hoisted(() => ({
	createCompose: vi.fn(async () => ({ composeId: "created", appName: "example-app" })),
	updateComposeById: vi.fn(async (_id: string, _values: Record<string, unknown>) => undefined),
	findTemplateById: vi.fn(),
}));

vi.mock("../../db", () => ({
	db: { query: { environments: { findFirst: async () => ({ environmentId: "env" }) } } },
}));
vi.mock("../projects", () => ({
	findProjectById: async () => ({ projectId: "project" }),
	assertWithinQuota: async () => undefined,
}));
vi.mock("../compose/service", () => ({
	createCompose,
	updateComposeById,
	resyncComposeDomains: vi.fn(),
}));
vi.mock("../deployment", () => ({ queueDeployment: async () => "deployment" }));
vi.mock("../dns", () => ({ ensureDnsRecords: async () => [] }));
vi.mock("./catalog", () => ({ findTemplateById, listTemplateSummaries: () => [] }));

const { deployTemplate } = await import("./index");

const template: Template = {
	id: "example",
	name: "Example",
	description: "",
	logo: "",
	category: "Apps",
	tags: [],
	links: {},
	compose: "services:\n  app:\n    image: example/app:1\n",
	env: [],
	suggestedDomain: { serviceName: "app", port: 3000 },
};
const input = { templateId: "example", projectId: "project", environmentName: "production" };
const requiredCompose = `services:
  app:
    image: example/app:1
    environment:
      PASSWORD: \${DB_PASSWORD:?Supply a strong password}
      REPEATED: \${DB_PASSWORD}
`;

beforeEach(() => {
	createCompose.mockClear();
	updateComposeById.mockClear();
	findTemplateById.mockReturnValue(template);
});

describe("template installation preflight", () => {
	it("rejects a missing domain before creating any service", async () => {
		findTemplateById.mockReturnValue({ ...template, requiresDomain: true });
		await expect(deployTemplate("org", input)).rejects.toThrow(/needs a domain for app:3000/);
		expect(createCompose).not.toHaveBeenCalled();
	});

	it("requires a domain on the declared internal port rather than accepting a different route", async () => {
		findTemplateById.mockReturnValue({ ...template, requiresDomain: true });
		await expect(
			deployTemplate("org", {
				...input,
				domains: [{ host: "app.example.com", serviceName: "app", port: 8080 }],
			}),
		).rejects.toThrow(/needs a domain for app:3000/);
		expect(createCompose).not.toHaveBeenCalled();
	});

	it("rejects a missing required value before creating any service", async () => {
		findTemplateById.mockReturnValue({
			...template,
			env: [{ key: "API_KEY", default: "", description: "Required", required: true }],
		});
		await expect(deployTemplate("org", input)).rejects.toThrow(
			/Required template variable API_KEY/,
		);
		expect(createCompose).not.toHaveBeenCalled();
	});

	it.each([undefined, "", "   "])(
		"rejects translated required input %j before creating any service",
		async (value) => {
			const translated = parseCoolifyCatalog({
				example: { compose: Buffer.from(requiredCompose).toString("base64") },
			}).templates[0];
			expect(translated).toBeDefined();
			findTemplateById.mockReturnValue(translated);
			await expect(
				deployTemplate("org", {
					...input,
					...(value === undefined ? {} : { envValues: { DB_PASSWORD: value } }),
				}),
			).rejects.toThrow(/Required template variable DB_PASSWORD/);
			expect(createCompose).not.toHaveBeenCalled();
			expect(updateComposeById).not.toHaveBeenCalled();
		},
	);

	it("installs a translated required value only when supplied explicitly", async () => {
		const translated = parseCoolifyCatalog({
			example: { compose: Buffer.from(requiredCompose).toString("base64") },
		}).templates[0];
		expect(translated).toBeDefined();
		findTemplateById.mockReturnValue(translated);
		await deployTemplate("org", { ...input, envValues: { DB_PASSWORD: "chosen-password" } });
		expect(createCompose).toHaveBeenCalledOnce();
		expect(updateComposeById).toHaveBeenCalledWith(
			"created",
			expect.objectContaining({ env: "DB_PASSWORD=chosen-password" }),
		);
	});

	it("writes generated values once at installation, uses explicit overrides, and creates fresh values for another install", async () => {
		findTemplateById.mockReturnValue({
			...template,
			env: [
				{ key: "PASS", default: "{{generatePassword:32:SERVICE_PASSWORD_DB}}", description: "" },
				{
					key: "URL",
					default: "postgres://db:{{generatePassword:32:SERVICE_PASSWORD_DB}}@db/app",
					description: "",
				},
				{ key: "API_KEY", default: "", description: "Required", required: true },
			],
		});
		await deployTemplate("org", { ...input, envValues: { API_KEY: "provided" } });
		const first = updateComposeById.mock.calls[0]?.[1] as { env: string } | undefined;
		const values = Object.fromEntries(
			(first?.env ?? "").split("\n").map((line) => {
				const index = line.indexOf("=");
				return [line.slice(0, index), line.slice(index + 1)];
			}),
		);
		expect(values.PASS).toMatch(/^[A-Za-z0-9]{32}$/);
		expect(values.URL).toBe(`postgres://db:${values.PASS}@db/app`);
		expect(values.API_KEY).toBe("provided");
		await deployTemplate("org", { ...input, envValues: { API_KEY: "provided" } });
		const second = updateComposeById.mock.calls[1]?.[1] as { env: string } | undefined;
		expect(second?.env).not.toBe(first?.env);
	});
});
