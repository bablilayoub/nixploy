import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { BlueprintError, mapBlueprint } from "./blueprints";
import { resolveTemplateEnv } from "./placeholders";
import { remoteTemplateSchema } from "./schema";

/** `${name}` spelled so the linter does not read it as a template literal. */
const ref = (name: string): string => `$${"{"}${name}}`;
const assetUrl = (file: string) => `https://raw.example.test/blueprints/x/${file}`;

const plausible = {
	id: "plausible",
	meta: {
		id: "plausible",
		name: "Plausible",
		version: "v2.1.5",
		description: "Web analytics.",
		logo: "logo.svg",
		links: {
			github: "https://github.com/plausible/plausible",
			website: "https://plausible.io/",
			docs: "http://plausible.io/docs",
		},
		tags: ["analytics"],
	},
	toml: `[variables]
main_domain = "${ref("domain")}"
secret_base = "${ref("base64:64")}"
totp_key = "${ref("base64:32")}"

[[config.domains]]
serviceName = "plausible"
port = 8_000
host = "${ref("main_domain")}"

[config.env]
BASE_URL = "http://${ref("main_domain")}"
SECRET_KEY_BASE = "${ref("secret_base")}"
TOTP_VAULT_KEY = "${ref("totp_key")}"

[[config.mounts]]
filePath = "/clickhouse/clickhouse-config.xml"
content = """
<clickhouse>
  <logger><level>warning</level></logger>
</clickhouse>
"""

[[config.mounts]]
filePath = "/unused.txt"
content = "nobody mounts me"
`,
	compose: `services:
  plausible_db:
    image: postgres:16-alpine
    restart: always
    volumes:
      - db-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=postgres

  plausible_events_db:
    image: clickhouse/clickhouse-server:24.3.3.102-alpine
    restart: always
    volumes:
      - event-data:/var/lib/clickhouse
      - ../files/clickhouse/clickhouse-config.xml:/etc/clickhouse-server/config.d/logging.xml:ro
    ulimits:
      nofile:
        soft: 262144
        hard: 262144

  plausible:
    image: ghcr.io/plausible/community-edition:v2.1.5
    restart: always
    depends_on:
      - plausible_db
      - plausible_events_db
    env_file:
      - .env

volumes:
  db-data:
    driver: local
  event-data:
    driver: local
`,
	assetUrl,
};

describe("mapBlueprint", () => {
	it("produces a template the remote schema accepts", () => {
		const { template } = mapBlueprint(plausible);
		const parsed = remoteTemplateSchema.safeParse(template);
		expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
		expect(template).toMatchObject({
			id: "plausible",
			name: "Plausible",
			category: "Analytics",
			tags: ["analytics"],
			logo: "https://raw.example.test/blueprints/x/logo.svg",
			links: { github: "https://github.com/plausible/plausible", website: "https://plausible.io/" },
			suggestedDomain: { serviceName: "plausible", port: 8000 },
		});
		// http links are dropped, not kept.
		expect(template.links.docs).toBeUndefined();
	});

	it("turns helper variables into named deploy-time placeholders and the domain into {{domain}}", () => {
		const { template } = mapBlueprint(plausible);
		const env = Object.fromEntries(template.env.map((entry) => [entry.key, entry]));
		expect(env.BASE_URL).toEqual({
			key: "BASE_URL",
			default: "http://{{domain}}",
			description: "Uses the domain you attach at deploy",
		});
		expect(env.SECRET_KEY_BASE?.default).toBe("{{generateBase64:64:secret_base}}");
		expect(env.TOTP_VAULT_KEY?.default).toBe("{{generateBase64:32:totp_key}}");
		expect(env.SECRET_KEY_BASE?.description).toBe("Generated at deploy");

		// And those placeholders resolve into real values at deploy.
		const resolved = resolveTemplateEnv(
			template.env.map((entry) => ({ key: entry.key, value: entry.default })),
			{ domain: "stats.example.com" },
		);
		expect(resolved.BASE_URL).toBe("http://stats.example.com");
		expect(Buffer.from(resolved.SECRET_KEY_BASE ?? "", "base64")).toHaveLength(64);
	});

	it("rewrites file mounts into inline configs and env_file into environment entries", () => {
		const { template, notes } = mapBlueprint(plausible);
		const spec = parseYaml(template.compose) as {
			services: Record<string, Record<string, unknown>>;
			configs: Record<string, { content: string }>;
		};
		const events = spec.services.plausible_events_db ?? {};
		expect(events.volumes).toEqual(["event-data:/var/lib/clickhouse"]);
		expect(events.configs).toEqual([
			{
				source: "tpl-clickhouse-clickhouse-config-xml",
				target: "/etc/clickhouse-server/config.d/logging.xml",
			},
		]);
		expect(spec.configs["tpl-clickhouse-clickhouse-config-xml"]?.content).toContain("<clickhouse>");
		expect(spec.configs["tpl-unused-txt"]).toBeUndefined();
		expect(notes).toEqual(["file /unused.txt is defined but no service mounts it; dropped"]);

		const app = spec.services.plausible ?? {};
		expect(app.env_file).toBeUndefined();
		expect(app.environment).toEqual({
			BASE_URL: ref("BASE_URL"),
			SECRET_KEY_BASE: ref("SECRET_KEY_BASE"),
			TOTP_VAULT_KEY: ref("TOTP_VAULT_KEY"),
		});
		// A service that had its own environment keeps it and only gains the missing keys.
		expect(spec.services.plausible_db?.environment).toEqual(["POSTGRES_PASSWORD=postgres"]);
	});

	it("reads the array env form and keeps a helper used inline in an env value", () => {
		const { template } = mapBlueprint({
			id: "immich",
			meta: { name: "Immich", tags: ["photos"] },
			toml: `[variables]
main_domain = "${ref("domain")}"
db_password = "${ref("password")}"
db_user = "immich"

[config]
env = [
  "DB_USERNAME=${ref("db_user")}",
  "DB_PASSWORD=${ref("db_password")}",
  "DB_URL=postgres://${ref("db_user")}:${ref("db_password")}@db/immich",
  "ADMIN_TOKEN=${ref("hash:32")}",
  "TZ=UTC",
]
mounts = []

[[config.domains]]
serviceName = "immich-server"
port = 2_283
host = "${ref("main_domain")}"
`,
			compose:
				"services:\n  immich-server:\n    image: ghcr.io/immich-app/immich-server:release\n    env_file:\n      - .env\n",
			assetUrl,
		});
		const env = Object.fromEntries(template.env.map((entry) => [entry.key, entry.default]));
		expect(env.DB_USERNAME).toBe("immich");
		expect(env.DB_PASSWORD).toBe("{{generatePassword:16:db_password}}");
		expect(env.DB_URL).toBe("postgres://immich:{{generatePassword:16:db_password}}@db/immich");
		expect(env.ADMIN_TOKEN).toBe("{{generateHash:32:admin_token}}");
		const resolved = resolveTemplateEnv(
			template.env.map((entry) => ({ key: entry.key, value: entry.default })),
		);
		expect(resolved.DB_URL).toBe(`postgres://immich:${resolved.DB_PASSWORD}@db/immich`);
		// `photos` resolves to the catalog's own vocabulary rather than becoming
		// a category of its own (categories.ts).
		expect(template.category).toBe("Media");
	});

	it("signs literal-secret JWTs now and defers generated-secret JWTs to deploy", () => {
		const payload = `"""{
  "role": "anon",
  "exp": ${ref("timestamps:2030-01-01T00:00:00Z")}
}
"""`;
		const { template } = mapBlueprint({
			id: "sb",
			meta: { name: "SB" },
			toml: `[variables]
main_domain = "${ref("domain")}"
jwt_secret = "${ref("password:32")}"
fixed_secret = "not-a-secret-anymore"
anon_payload = ${payload}
anon_key = "${ref("jwt:jwt_secret:anon_payload")}"
fixed_key = "${ref("jwt:fixed_secret:anon_payload")}"
legacy_key = "${ref("jwt:16")}"

[[config.domains]]
serviceName = "kong"
port = 8_000
host = "${ref("main_domain")}"

[config.env]
JWT_SECRET = "${ref("jwt_secret")}"
ANON_KEY = "${ref("anon_key")}"
FIXED_KEY = "${ref("fixed_key")}"
LEGACY_KEY = "${ref("legacy_key")}"
`,
			compose: "services:\n  kong:\n    image: kong:2.8\n",
			assetUrl,
		});
		const env = Object.fromEntries(template.env.map((entry) => [entry.key, entry.default]));
		expect(env.JWT_SECRET).toBe("{{generatePassword:32:jwt_secret}}");
		expect(env.ANON_KEY).toMatch(/^\{\{generateJwt:jwt_secret:[A-Za-z0-9_-]+\}\}$/);
		expect(env.FIXED_KEY?.split(".")).toHaveLength(3);
		expect(env.LEGACY_KEY).toBe("{{generateHash:32:legacy_key}}");
		const resolved = resolveTemplateEnv(
			template.env.map((entry) => ({ key: entry.key, value: entry.default })),
		);
		const body = JSON.parse(
			Buffer.from(resolved.ANON_KEY?.split(".")[1] ?? "", "base64url").toString(),
		);
		expect(body).toEqual({ role: "anon", exp: 1893456000 });
	});

	it("refuses what it cannot carry, with the reason", () => {
		const base = { id: "x", meta: { name: "X" }, assetUrl };
		expect(() =>
			mapBlueprint({ ...base, toml: "[variables]\na = 1\n", compose: "services: {}\n" }),
		).toThrow(BlueprintError);
		// A ../files/<dir> the blueprint does not declare is persistent storage:
		// it becomes a named volume of the stack rather than a rejection.
		const directory = mapBlueprint({
			...base,
			toml: `[[config.domains]]\nserviceName = "a"\nport = 1\nhost = "h"\n`,
			compose: "services:\n  a:\n    image: x\n    volumes:\n      - ../files/uploads:/x\n",
		});
		expect(directory.template.compose).toContain("tpl-uploads:/x");
		expect(directory.template.compose).toMatch(/volumes:\n {2}tpl-uploads: \{\}/);
		expect(directory.notes[0]).toContain("kept as the named volume tpl-uploads");
		// Routing labels of the other panel are dropped rather than rejected.
		const labelled = mapBlueprint({
			...base,
			toml: `[[config.domains]]\nserviceName = "a"\nport = 1\nhost = "h"\n`,
			compose:
				"services:\n  a:\n    image: x\n    labels:\n      - traefik.enable=true\n      - com.example.keep=1\n",
		});
		expect(labelled.template.compose).not.toContain("traefik.enable");
		expect(labelled.template.compose).toContain("com.example.keep=1");
		expect(labelled.notes.join(" ")).toContain("dropped 1 traefik.* label");
		// The map form, and a service whose only labels were routing ones.
		const mapped = mapBlueprint({
			...base,
			toml: `[[config.domains]]\nserviceName = "a"\nport = 1\nhost = "h"\n`,
			compose: 'services:\n  a:\n    image: x\n    labels:\n      traefik.enable: "true"\n',
		});
		expect(mapped.template.compose).not.toContain("labels");
		// `./files/` as well as `../files/`, and a mode flag that means nothing
		// once the file is an inline config or a named volume.
		const selinux = mapBlueprint({
			...base,
			toml: `[[config.domains]]\nserviceName = "a"\nport = 1\nhost = "h"\n`,
			compose: "services:\n  a:\n    image: x\n    volumes:\n      - ./files/uploads:/x:Z\n",
		});
		expect(selinux.template.compose).toContain("tpl-uploads:/x");
		expect(selinux.template.compose).not.toContain(":Z");
		// No domain and nothing exposed (a tunnel client, a cache): the first
		// service on 80 is a placeholder, not a reason to drop the template.
		const unexposed = mapBlueprint({
			...base,
			toml: "[config]\nmounts = []\n",
			compose: "services:\n  a: {}\n",
		});
		expect(unexposed.template.suggestedDomain).toEqual({ serviceName: "a", port: 80 });
		expect(unexposed.notes.join(" ")).toContain("placeholder suggestion");
		// No domain but an exposed port: suggested from it.
		const exposed = mapBlueprint({
			...base,
			toml: "[config]\nmounts = []\n",
			compose: "services:\n  web:\n    image: x\n    expose:\n      - 8080\n",
		});
		expect(exposed.template.suggestedDomain).toEqual({ serviceName: "web", port: 8080 });
		expect(() =>
			mapBlueprint({
				...base,
				toml: `[[config.domains]]\nserviceName = "a"\nport = 1\nhost = "h"\n[config.env]\nBAD-KEY = "1"\n`,
				compose: "services:\n  a: {}\n",
			}),
		).toThrow(/not shell-safe/);
	});
});
