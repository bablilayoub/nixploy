import { describe, expect, it } from "vitest";
import { parseEnv } from "../deployment/env";
import {
	coolifyApplication,
	coolifyCompose,
	coolifyDatabase,
	coolifyEnv,
	coolifyResourceSchema,
} from "./coolify-normalize";
import { type ImportNote, normalizeSourceEnvironment } from "./normalize";
import { sourceProjectSummarySchema } from "./source-schema";

const application = (fields: Record<string, unknown> = {}) =>
	coolifyResourceSchema.parse({
		uuid: "app-source-1",
		name: "web",
		build_pack: "dockerimage",
		docker_registry_image_name: "traefik/whoami",
		docker_registry_image_tag: "v1.10.1",
		ports_exposes: "80",
		fqdn: "http://app.example.test",
		...fields,
	});
const env = {
	key: "API_TOKEN",
	value: "ENV_SECRET_CANARY",
	is_runtime: true,
	is_buildtime: true,
	is_preview: false,
};
const notes = (): ImportNote[] => [];

describe("Coolify normalization", () => {
	it("maps image and domain configuration without leaking source values into the manifest or notes", () => {
		const messages = notes();
		const row = coolifyApplication(application(), [env], messages);
		expect(row).toMatchObject({
			sourceType: "docker",
			dockerImage: "traefik/whoami:v1.10.1",
			env: "API_TOKEN=ENV_SECRET_CANARY",
			buildArgs: "API_TOKEN=ENV_SECRET_CANARY",
			autoDeploy: false,
			domains: [{ host: "app.example.test", port: 80, https: false }],
		});
		const project = sourceProjectSummarySchema.parse({
			projectId: "project-1",
			name: "source",
			environments: [{ environmentId: "env-1", name: "production" }],
		});
		const environment = project.environments[0];
		if (!environment) throw new Error("missing test environment");
		const result = normalizeSourceEnvironment({
			project,
			environment,
			applications: [row],
			compose: [],
			databases: { postgres: [], mysql: [], mariadb: [], mongo: [], redis: [] },
			knownServers: new Set(),
			knownRegistries: new Set(),
		});
		expect(
			JSON.stringify({ manifest: result.manifest, notes: [...result.notes, ...messages] }),
		).not.toContain("ENV_SECRET_CANARY");
		expect(result.secrets.applications?.web?.env).toBe("API_TOKEN=ENV_SECRET_CANARY");
		expect(result.manifest.applications?.[0]).not.toHaveProperty("mounts");
		expect(result.manifest.applications?.[0]).not.toHaveProperty("ports");
	});
	it.each([
		undefined,
		null,
		"{{project.PRIVATE_TOKEN}}",
		"multi\nline",
		" value ",
		"enc:v1:ciphertext",
		"eyJpdiI6ciphertext",
		'"literal quoted value"',
	])("leaves an unreadable or unrepresentable env group unavailable: %s", (value) => {
		const messages = notes();
		const converted = coolifyEnv([{ ...env, value }], "env", messages, "application/web");
		expect(converted).toEqual({ unavailable: true });
		expect(messages).toHaveLength(1);
		expect(JSON.stringify(messages)).not.toContain("PRIVATE_TOKEN");
	});
	it("keeps explicit empty strings and literal special characters unchanged", () => {
		const messages = notes();
		const value = "dollar$ # hash = apostrophe' slash\\";
		const result = coolifyEnv(
			[
				{ ...env, key: "EMPTY", value: "" },
				{ ...env, key: "SPECIAL", value },
			],
			"env",
			messages,
			"application/web",
		);
		expect(parseEnv(result.value)).toEqual([
			["EMPTY", ""],
			["SPECIAL", value],
		]);
		expect(messages).toEqual([]);
	});
	it("separates runtime, build and preview values and never uses shell-escaped real_value", () => {
		const rows = [
			env,
			{ ...env, key: "BUILD", value: "build-only", is_runtime: false },
			{ ...env, key: "PREVIEW", value: "preview", is_preview: true },
			{
				...env,
				key: "RUNTIME",
				value: "runtime",
				real_value: "'incorrect shell representation'",
				is_buildtime: false,
			},
		];
		expect(coolifyEnv(rows, "env", notes(), "application/web").value).toBe(
			"API_TOKEN=ENV_SECRET_CANARY\nRUNTIME=runtime",
		);
		expect(coolifyEnv(rows, "buildArgs", notes(), "application/web").value).toBe(
			"API_TOKEN=ENV_SECRET_CANARY\nBUILD=build-only",
		);
		expect(coolifyEnv(rows, "previewEnv", notes(), "application/web").value).toBe(
			"PREVIEW=preview",
		);
	});
	it("maps credential-free public Git URLs and relative repository paths", () => {
		const row = coolifyApplication(
			application({
				build_pack: "dockerfile",
				git_repository: "https://github.com/example/web.git",
				git_branch: "deploy",
				base_directory: "/apps/web",
				dockerfile_location: "/Dockerfile",
				publish_directory: "/dist",
			}),
			[],
			notes(),
		);
		expect(row).toMatchObject({
			sourceType: "git",
			customGitUrl: "https://github.com/example/web.git",
			customGitBranch: "deploy",
			buildPath: "apps/web",
			dockerfile: "Dockerfile",
			publishDirectory: "dist",
		});
	});
	it("does not infer a private provider URL or carry a credential embedded in a clone URL", () => {
		const messages = notes();
		const row = coolifyApplication(
			application({
				build_pack: "nixpacks",
				git_repository: "https://user:GIT_SECRET_CANARY@git.example.test/repo.git",
			}),
			[],
			messages,
		);
		expect(row.customGitUrl).toBeUndefined();
		expect(row.unavailableFields).toContain("gitUrl");
		expect(JSON.stringify(messages)).not.toContain("GIT_SECRET_CANARY");
	});
	it("refuses unsupported build packs and a redacted Compose source", () => {
		expect(() => coolifyApplication(application({ build_pack: "unknown" }), [], notes())).toThrow(
			/unsupported build pack/,
		);
		expect(() => coolifyCompose(application(), [], notes())).toThrow(/read:sensitive/);
	});
	it("uses raw Compose and container domains, never the source's rendered proxy configuration", () => {
		const row = coolifyCompose(
			application({
				docker_compose_raw: "services:\n  web:\n    image: nginx\n",
				docker_compose: "services: {proxy: {privileged: true}}",
				applications: [
					{ name: "web", fqdn: "https://stack.example.test:8080/path", exposes: "80" },
				],
			}),
			[env],
			notes(),
		);
		expect(row.composeFile).toBe("services:\n  web:\n    image: nginx\n");
		expect(row.domains).toMatchObject([
			{ host: "stack.example.test", port: 8080, path: "/path", serviceName: "web", https: true },
		]);
		expect(row.composeId).toBe("service:app-source-1");
	});
	it("preserves explicit conventional-port suffixes that URL normalization would erase", () => {
		const row = coolifyApplication(
			application({ fqdn: "https://web.example.test:443/path", ports_exposes: "3000" }),
			[],
			notes(),
		);
		expect(row.domains[0]?.port).toBe(443);
	});
	it("does not copy a database password or republish its host port", () => {
		const row = coolifyDatabase(
			"postgres",
			application({
				postgres_db: "source",
				postgres_user: "sourceuser",
				postgres_password: "PASSWORD_SECRET_CANARY",
				image: "postgres:17",
				public_port: 54322,
			}),
			notes(),
		);
		expect(row).toMatchObject({
			databaseName: "source",
			databaseUser: "sourceuser",
			dockerImage: "postgres:17",
			unavailableFields: expect.arrayContaining(["env", "externalPort"]),
		});
		expect(JSON.stringify(row)).not.toContain("PASSWORD_SECRET_CANARY");
	});
	it("preserves target domain settings when a source route has no readable backend port", () => {
		const messages = notes();
		const row = coolifyCompose(
			application({
				docker_compose_raw: "services:\n  web:\n    image: nginx\n",
				applications: [{ name: "web", fqdn: "http://no-port.example.test" }],
			}),
			[],
			messages,
		);
		expect(row.domains).toEqual([]);
		expect(row.unavailableFields).toContain("domains");
		expect(messages.some((note) => note.message.includes("Existing target domains are kept"))).toBe(
			true,
		);
	});
	it("uses the service API's editable URL to retain its hidden port override", () => {
		const row = coolifyCompose(
			application({
				docker_compose_raw: "services:\n  web:\n    image: nginx\n",
				applications: [
					{ name: "web", fqdn: "http://stack.example.test", url: "http://stack.example.test:8080" },
				],
			}),
			[],
			notes(),
		);
		expect(row.domains[0]?.port).toBe(8080);
	});
	it("keeps embedded image tags and rejects clone URL query credentials", () => {
		expect(
			coolifyApplication(
				application({
					docker_registry_image_name: "nginx:alpine",
					docker_registry_image_tag: "latest",
				}),
				[],
				notes(),
			).dockerImage,
		).toBe("nginx:alpine");
		const messages = notes();
		const row = coolifyApplication(
			application({
				build_pack: "railpack",
				git_repository: "https://git.example.test/team/repo.git?token=QUERY_SECRET_CANARY",
			}),
			[],
			messages,
		);
		expect(row.customGitUrl).toBeUndefined();
		expect(JSON.stringify(messages)).not.toContain("QUERY_SECRET_CANARY");
	});
	it("marks unsupported preview build-only variables unavailable without widening their scope", () => {
		const messages = notes();
		const rows = [{ ...env, is_preview: true, is_runtime: false }];
		expect(coolifyEnv(rows, "buildArgs", messages, "application/web").value).toBe("");
		expect(coolifyEnv(rows, "previewEnv", messages, "application/web")).toEqual({
			unavailable: true,
		});
		expect(JSON.stringify(messages)).not.toContain("ENV_SECRET_CANARY");
	});
});
