import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { execAsync, execAsyncWithStdin } from "../../utils/exec";
import { shellQuote } from "../deployment/paths";
import { badRequest } from "../errors";
import type { DatabaseServiceKind } from "../services/registry";
import { dumpFilePath, type StoredDump } from "./dump-store";
import type { SourceReader } from "./reader";
import {
	type SourceApplication,
	type SourceCompose,
	type SourceDatabase,
	type SourceProjectSummary,
	sourceApplicationSchema,
	sourceComposeSchema,
	sourceDatabaseSchema,
	sourceProjectListSchema,
} from "./source-schema";

/**
 * The offline path of the importer: the source panel is dead, its Postgres
 * volume or a `pg_dump` of it is what is left. The dump is restored into a
 * throwaway Postgres container on `--network none` (the same pattern as
 * backup restore verification), read with `row_to_json` — the source's
 * drizzle rows carry the same camelCase column names its API returns, so the
 * live-API schemas parse them unchanged — and the container is removed.
 *
 * Nothing about the source's tables is hard-coded beyond the names the API
 * path already relies on (`environmentId`, `applicationId`, `composeId`,
 * `<kind>Id`); the child tables are discovered from `information_schema`
 * among a few candidate names, so a rename upstream is a note, not a crash.
 */

export const DUMP_CONTAINER_PREFIX = "nixploy-import-";
export const DUMP_CONTAINER_LABEL = "nixploy.import=1";
export const DUMP_POSTGRES_IMAGE =
	process.env.NIXPLOY_IMPORT_POSTGRES_IMAGE ?? "postgres:17-alpine";
const READY_ATTEMPTS = 60;
const READY_INTERVAL_S = 2;
const RESTORE_TIMEOUT_MS = 30 * 60 * 1000;
const QUERY_TIMEOUT_MS = 60_000;
const MAX_RESULT_BYTES = 32 * 1024 * 1024;

const sq = shellQuote;

interface TableNames {
	project: string;
	environment: string;
	application: string;
	compose: string;
	domain: string | null;
	mount: string | null;
	port: string | null;
	redirect: string | null;
	security: string | null;
	databases: Partial<Record<DatabaseServiceKind, string>>;
}

const CANDIDATES: Record<keyof Omit<TableNames, "databases">, string[]> = {
	project: ["project", "projects"],
	environment: ["environment", "environments"],
	application: ["application", "applications"],
	compose: ["compose", "composes"],
	domain: ["domain", "domains"],
	mount: ["mount", "mounts"],
	port: ["port", "ports"],
	redirect: ["redirect", "redirects"],
	security: ["security", "securities"],
};

/** Pick the source's actual table names from the restored schema. Exported for tests. */
export function resolveTableNames(existing: readonly string[]): TableNames {
	const has = new Set(existing.map((name) => name.toLowerCase()));
	const pick = (candidates: readonly string[]): string | null =>
		candidates.find((candidate) => has.has(candidate)) ?? null;
	const required = (key: "project" | "environment" | "application" | "compose"): string => {
		const found = pick(CANDIDATES[key]);
		if (!found) {
			throw badRequest(
				`The dump has no "${key}" table — is this a dump of the source panel's own database?`,
			);
		}
		return found;
	};
	const databases: Partial<Record<DatabaseServiceKind, string>> = {};
	for (const kind of ["postgres", "mysql", "mariadb", "mongo", "redis"] as const) {
		const found = pick([kind]);
		if (found) databases[kind] = found;
	}
	return {
		project: required("project"),
		environment: required("environment"),
		application: required("application"),
		compose: required("compose"),
		domain: pick(CANDIDATES.domain),
		mount: pick(CANDIDATES.mount),
		port: pick(CANDIDATES.port),
		redirect: pick(CANDIDATES.redirect),
		security: pick(CANDIDATES.security),
		databases,
	};
}

/** `"name"` — quoted, and refused if it is not a plain identifier. */
const ident = (name: string): string => {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) throw badRequest(`Unsafe identifier: ${name}`);
	return `"${name}"`;
};

/** SQL string literal for an id value (the source's ids are short opaque strings). */
const literal = (value: string): string => {
	if (value.length > 200 || /[\0]/.test(value)) throw badRequest("Unsafe id value");
	return `'${value.replace(/'/g, "''")}'`;
};

export class DumpSourceReader implements SourceReader {
	readonly host: string;
	private tables: TableNames | null = null;

	private constructor(
		private readonly container: string,
		private readonly meta: StoredDump,
	) {
		this.host = `dump:${meta.filename}`;
	}

	/** Start the throwaway Postgres, restore the dump into it, discover the tables. */
	static async open(meta: StoredDump): Promise<DumpSourceReader> {
		const container = `${DUMP_CONTAINER_PREFIX}${randomBytes(8).toString("hex")}`;
		const password = randomBytes(18).toString("base64url");
		const reader = new DumpSourceReader(container, meta);
		try {
			await execAsync(
				`docker run -d --name ${sq(container)} --network none --label ${sq(DUMP_CONTAINER_LABEL)} ` +
					`--memory 1g --pids-limit 256 -e POSTGRES_PASSWORD=${sq(password)} -e POSTGRES_DB=source ${sq(DUMP_POSTGRES_IMAGE)}`,
				{ timeout: 120_000 },
			);
			await execAsync(
				`i=0; while [ $i -lt ${READY_ATTEMPTS} ]; do docker exec ${sq(container)} pg_isready -U postgres -d source >/dev/null 2>&1 && exit 0; sleep ${READY_INTERVAL_S}; i=$((i + 1)); done; echo 'postgres did not come up' >&2; exit 1`,
				{ timeout: (READY_ATTEMPTS * READY_INTERVAL_S + 10) * 1000 },
			);
			await reader.restore();
			reader.tables = resolveTableNames(await reader.listTables());
			return reader;
		} catch (error) {
			await reader.close();
			throw error;
		}
	}

	private async restore(): Promise<void> {
		const file = dumpFilePath(this.meta.organizationId, this.meta.dumpId);
		// The dump is streamed from disk on stdin — never an argv blob — and
		// restore errors that are only about ownership/extensions are tolerated:
		// what matters is that the tables the importer reads come through.
		const decode = this.meta.gzipped ? "gunzip -c" : "cat";
		const load =
			this.meta.format === "custom"
				? `pg_restore -U postgres -d source --no-owner --no-privileges --no-acl`
				: `psql -U postgres -d source -q -v ON_ERROR_STOP=0`;
		const command = `${decode} | docker exec -i ${sq(this.container)} sh -c ${sq(load)} >/dev/null 2>&1; true`;
		await new Promise<void>((resolve, reject) => {
			const stream = createReadStream(file);
			const chunks: Buffer[] = [];
			stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
			stream.on("error", reject);
			stream.on("end", () => {
				execAsyncWithStdin(command, Buffer.concat(chunks), { timeout: RESTORE_TIMEOUT_MS })
					.then(() => resolve())
					.catch(reject);
			});
		});
	}

	private async query(sql: string): Promise<unknown> {
		const raw = await execAsyncWithStdin(
			`docker exec -i ${sq(this.container)} psql -U postgres -d source -tA -v ON_ERROR_STOP=1`,
			`${sql}\n`,
			{ timeout: QUERY_TIMEOUT_MS },
		);
		if (raw.length > MAX_RESULT_BYTES) throw badRequest("The dump's rows are too large to read");
		const text = raw.trim();
		if (!text) return null;
		try {
			return JSON.parse(text);
		} catch {
			throw badRequest("Could not read the restored rows as JSON");
		}
	}

	private async listTables(): Promise<string[]> {
		const rows = await this.query(
			"select coalesce(json_agg(table_name), '[]') from information_schema.tables where table_schema = 'public';",
		);
		return Array.isArray(rows) ? rows.filter((row): row is string => typeof row === "string") : [];
	}

	private table(): TableNames {
		if (!this.tables) throw new Error("Dump reader is not open");
		return this.tables;
	}

	private childRows(table: string | null, parentColumn: string, parentId: string): string {
		if (!table) return "'[]'::json";
		return `(select coalesce(json_agg(row_to_json(c)), '[]') from ${ident(table)} c where c.${ident(parentColumn)} = ${literal(parentId)})`;
	}

	async listProjects(): Promise<SourceProjectSummary[]> {
		const t = this.table();
		const services = (["postgres", "mysql", "mariadb", "mongo", "redis"] as const)
			.map((kind) => {
				const table = t.databases[kind];
				return table
					? `'${kind}', (select coalesce(json_agg(json_build_object('${kind}Id', s.${ident(`${kind}Id`)}, 'name', s.name)), '[]') from ${ident(table)} s where s.${ident("environmentId")} = e.${ident("environmentId")})`
					: `'${kind}', '[]'::json`;
			})
			.join(", ");
		const sql = `select coalesce(json_agg(json_build_object(
			'projectId', p.${ident("projectId")}, 'name', p.name, 'description', p.description, 'env', p.env,
			'environments', (select coalesce(json_agg(json_build_object(
				'environmentId', e.${ident("environmentId")}, 'name', e.name, 'description', e.description, 'env', e.env,
				'applications', (select coalesce(json_agg(json_build_object('applicationId', a.${ident("applicationId")}, 'name', a.name)), '[]') from ${ident(t.application)} a where a.${ident("environmentId")} = e.${ident("environmentId")}),
				'compose', (select coalesce(json_agg(json_build_object('composeId', c.${ident("composeId")}, 'name', c.name)), '[]') from ${ident(t.compose)} c where c.${ident("environmentId")} = e.${ident("environmentId")}),
				${services},
				'libsql', '[]'::json
			)), '[]') from ${ident(t.environment)} e where e.${ident("projectId")} = p.${ident("projectId")})
		)), '[]') from ${ident(t.project)} p;`;
		const parsed = sourceProjectListSchema.safeParse(await this.query(sql));
		if (!parsed.success) {
			throw badRequest(`The dump's project rows did not parse: ${parsed.error.issues[0]?.message}`);
		}
		return parsed.data;
	}

	async getApplication(applicationId: string): Promise<SourceApplication> {
		const t = this.table();
		const sql = `select row_to_json(a)::jsonb
			|| jsonb_build_object(
				'domains', ${this.childRows(t.domain, "applicationId", applicationId)},
				'mounts', ${this.childRows(t.mount, "applicationId", applicationId)},
				'ports', ${this.childRows(t.port, "applicationId", applicationId)},
				'redirects', ${this.childRows(t.redirect, "applicationId", applicationId)},
				'security', ${this.childRows(t.security, "applicationId", applicationId)})
			from ${ident(t.application)} a where a.${ident("applicationId")} = ${literal(applicationId)};`;
		const parsed = sourceApplicationSchema.safeParse(await this.query(sql));
		if (!parsed.success)
			throw badRequest(`Application ${applicationId} did not parse from the dump`);
		return parsed.data;
	}

	async getCompose(composeId: string): Promise<SourceCompose> {
		const t = this.table();
		const sql = `select row_to_json(c)::jsonb
			|| jsonb_build_object(
				'domains', ${this.childRows(t.domain, "composeId", composeId)},
				'mounts', ${this.childRows(t.mount, "composeId", composeId)})
			from ${ident(t.compose)} c where c.${ident("composeId")} = ${literal(composeId)};`;
		const parsed = sourceComposeSchema.safeParse(await this.query(sql));
		if (!parsed.success) throw badRequest(`Compose ${composeId} did not parse from the dump`);
		return parsed.data;
	}

	async getDatabase(kind: DatabaseServiceKind, id: string): Promise<SourceDatabase> {
		const table = this.table().databases[kind];
		if (!table) throw badRequest(`The dump has no ${kind} table`);
		const sql = `select row_to_json(d) from ${ident(table)} d where d.${ident(`${kind}Id`)} = ${literal(id)};`;
		const parsed = sourceDatabaseSchema.safeParse(await this.query(sql));
		if (!parsed.success) throw badRequest(`${kind} ${id} did not parse from the dump`);
		return parsed.data;
	}

	async close(): Promise<void> {
		await execAsync(`docker rm -f ${sq(this.container)} >/dev/null 2>&1 || true`, {
			timeout: 60_000,
		}).catch(() => {});
	}
}

/** Remove import containers a crashed process left behind (boot + maintenance). */
export async function pruneImportContainers(): Promise<void> {
	await execAsync(
		`docker ps -aq --filter label=${sq(DUMP_CONTAINER_LABEL)} | xargs -r docker rm -f >/dev/null 2>&1 || true`,
		{ timeout: 60_000 },
	).catch(() => {});
}
