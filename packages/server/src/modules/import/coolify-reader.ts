import { z } from "zod";
import { assertSafeOutboundUrl, pinnedFetch, type SafeTarget } from "../../utils/public-url";
import { badRequest } from "../errors";
import { DATABASE_KINDS, type DatabaseServiceKind } from "../services/registry";
import type { SourceClientOptions } from "./client";
import {
	type CoolifyResource,
	type CoolifyRow,
	coolifyApplication,
	coolifyCompose,
	coolifyDatabase,
	coolifyResourceSchema,
	coolifyText,
} from "./coolify-normalize";
import type { ImportNote } from "./normalize";
import type { SourceReader } from "./reader";
import { type SourceProjectSummary, sourceProjectSummarySchema } from "./source-schema";

const rowSchema = z.record(z.string(), z.unknown());
const databaseRelations: Record<DatabaseServiceKind, string> = {
	postgres: "postgresqls",
	mysql: "mysqls",
	mariadb: "mariadbs",
	mongo: "mongodbs",
	redis: "redis",
};
const databaseTypes: Record<DatabaseServiceKind, string> = {
	postgres: "standalone-postgresql",
	mysql: "standalone-mysql",
	mariadb: "standalone-mariadb",
	mongo: "standalone-mongodb",
	redis: "standalone-redis",
};
const parse = <T>(schema: z.ZodType<T>, value: unknown, label: string): T => {
	const result = schema.safeParse(value);
	if (!result.success)
		throw badRequest(
			`Coolify returned an unexpected ${label} response; no source response body was retained`,
		);
	return result.data;
};
const rows = (value: unknown, label: string) => parse(z.array(rowSchema), value, label);
const resources = (value: unknown, label: string) =>
	parse(z.array(coolifyResourceSchema), value, label);

/** Official Coolify v4 `/api/v1`: transient Bearer token and address-pinned GET requests only. */
export class CoolifySourceReader implements SourceReader {
	private readonly notes: ImportNote[] = [];
	private constructor(
		private readonly target: SafeTarget,
		private readonly apiKey: string,
	) {}
	static async connect(options: SourceClientOptions): Promise<CoolifySourceReader> {
		const target = await assertSafeOutboundUrl(options.url, {
			allowPrivate: true,
			allowHttp: true,
		});
		return new CoolifySourceReader(target, options.apiKey);
	}
	get host() {
		return this.target.url.host;
	}
	getNotes(): ImportNote[] {
		return [...this.notes];
	}
	async close(): Promise<void> {}
	private async get(path: string): Promise<unknown> {
		const url = new URL(`/api/v1/${path}`, this.target.url.origin);
		let response: Awaited<ReturnType<typeof pinnedFetch>>;
		try {
			response = await pinnedFetch(
				{ ...this.target, url },
				{
					method: "GET",
					timeoutMs: 30_000,
					maxBytes: 16 * 1024 * 1024,
					headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
				},
			);
		} catch {
			throw badRequest(
				"Could not reach the Coolify API. Check its URL, network access and API allowlist",
			);
		}
		if (response.status === 401)
			throw badRequest(
				"Coolify rejected the API token. Create a team-scoped read token, adding read:sensitive for environment values and Compose content",
			);
		if (response.status === 403)
			throw badRequest(
				"Coolify denied this read. Enable its API and check the token's team permissions, sensitive-read ability and IP allowlist",
			);
		if (!response.ok)
			throw badRequest(
				`Coolify API request failed (HTTP ${response.status}${response.status >= 300 && response.status < 400 ? "; redirects are not followed" : ""})`,
			);
		try {
			return response.json();
		} catch {
			throw badRequest(
				"Coolify returned a non-JSON API response. Use the panel origin, not a login or proxy URL",
			);
		}
	}
	private async resource(
		type: "applications" | "services" | "databases",
		id: string,
	): Promise<CoolifyResource> {
		return parse(coolifyResourceSchema, await this.get(`${type}/${encodeURIComponent(id)}`), type);
	}
	private async envs(type: "applications" | "services", id: string): Promise<CoolifyRow[]> {
		return rows(await this.get(`${type}/${encodeURIComponent(id)}/envs`), "environment variables");
	}
	async listProjects(): Promise<SourceProjectSummary[]> {
		const projects = resources(await this.get("projects"), "projects");
		const allDatabases = resources(await this.get("databases"), "database inventory");
		const output: SourceProjectSummary[] = [];
		for (const summary of projects) {
			const project = parse(
				coolifyResourceSchema,
				await this.get(`projects/${encodeURIComponent(summary.uuid)}`),
				"project",
			);
			const environments: CoolifyRow[] = [];
			for (const summaryEnv of rows(project.environments, "project environments")) {
				const name = coolifyText(summaryEnv, "name");
				if (!name) throw badRequest("Coolify returned an environment without a name");
				const id = coolifyText(summaryEnv, "uuid") ?? name;
				const env = parse(
					rowSchema,
					await this.get(`projects/${encodeURIComponent(project.uuid)}/${encodeURIComponent(id)}`),
					"environment inventory",
				);
				const apps = resources(env.applications ?? [], "applications");
				const compose = resources(env.services ?? [], "services").map((row) => ({
					composeId: `service:${row.uuid}`,
					name: row.name,
				}));
				const applications: Array<{ applicationId: string; name: string }> = [];
				const unsupportedApps: Array<{ id: string; name: string; kind: string }> = [];
				for (const row of apps) {
					if (
						["dockerimage", "dockerfile", "nixpacks", "railpack", "static"].includes(
							String(row.build_pack),
						)
					)
						applications.push({ applicationId: row.uuid, name: row.name });
					else
						unsupportedApps.push({
							id: row.uuid,
							name: row.name,
							kind: `application (${coolifyText(row, "build_pack") ?? "unknown build pack"})`,
						});
				}
				const databases = Object.fromEntries(
					DATABASE_KINDS.map((kind) => [
						kind,
						resources(env[databaseRelations[kind]] ?? [], `${kind} inventory`).map((row) => ({
							[`${kind}Id`]: row.uuid,
							name: row.name,
						})),
					]),
				);
				const supportedTypes = new Set(Object.values(databaseTypes));
				const unsupportedResources = [
					...unsupportedApps,
					...allDatabases
						.filter(
							(row) =>
								row.environment_id === env.id && !supportedTypes.has(String(row.database_type)),
						)
						.map((row) => ({
							id: row.uuid,
							name: row.name,
							kind:
								coolifyText(row, "database_type") ??
								("keydb_conf" in row ? "KeyDB" : "unknown database"),
						})),
				];
				environments.push({
					...databases,
					environmentId: id,
					name,
					description: coolifyText(env, "description"),
					unavailableFields: ["env"],
					applications,
					compose,
					unsupportedResources,
				});
			}
			output.push(
				sourceProjectSummarySchema.parse({
					projectId: project.uuid,
					name: project.name,
					description: coolifyText(project, "description"),
					unavailableFields: ["env"],
					environments,
				}),
			);
		}
		this.notes.push(
			{
				level: "warn",
				message:
					"Coolify team/project/environment shared variables are reference libraries, not inherited dotenv layers. They are not copied automatically; replace referenced values manually. Existing target project and environment variables are kept",
			},
			{
				level: "info",
				message:
					"This import supports applications, raw Compose snapshots and PostgreSQL/MySQL/MariaDB/MongoDB/Redis configuration. Other database engines, providers, registries, server keys, backups, schedules, proxy middleware and storage contents require manual setup. Target runtime names are fresh; this is not a same-host takeover",
			},
		);
		return output;
	}
	async getApplication(id: string) {
		return coolifyApplication(
			await this.resource("applications", id),
			await this.envs("applications", id),
			this.notes,
		);
	}
	async getCompose(id: string) {
		const [type, ...rest] = id.split(":");
		const uuid = rest.join(":");
		if (!uuid || type !== "service")
			throw badRequest("Invalid Coolify Compose resource identifier; inspect the source again");
		return coolifyCompose(
			await this.resource("services", uuid),
			await this.envs("services", uuid),
			this.notes,
		);
	}
	async getDatabase(kind: DatabaseServiceKind, id: string) {
		const row = await this.resource("databases", id);
		if (row.database_type !== databaseTypes[kind])
			throw badRequest("Coolify database type changed after inventory; inspect the source again");
		return coolifyDatabase(kind, row, this.notes);
	}
}
