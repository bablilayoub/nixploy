import { createHash } from "node:crypto";
import { z } from "zod";
import { badRequest } from "../errors";
import { toEnvString } from "../projects/env-values";
import type { DatabaseServiceKind } from "../services/registry";
import type { ImportNote } from "./normalize";
import {
	type SourceApplication,
	type SourceCompose,
	type SourceDatabase,
	type SourceDomain,
	sourceApplicationSchema,
	sourceComposeSchema,
	sourceDatabaseSchema,
} from "./source-schema";

/** Verified against the official v4.4.6 API; never accept rendered proxy Compose as raw source. */
export const coolifyResourceSchema = z
	.object({ uuid: z.string().min(1), name: z.string().min(1) })
	.passthrough();
export type CoolifyResource = z.infer<typeof coolifyResourceSchema>;
export type CoolifyRow = Record<string, unknown>;

export const coolifyText = (row: CoolifyRow, key: string): string | undefined =>
	typeof row[key] === "string" ? (row[key] as string) : undefined;
const presentText = (row: CoolifyRow, key: string) => coolifyText(row, key) || undefined;
const obj = (value: unknown): CoolifyRow =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as CoolifyRow) : {};
const relative = (value: string | undefined) => value?.replace(/^\/+/, "") || ".";
const limit = (row: CoolifyRow, field: string) => {
	const value = presentText(row, field);
	return value && value !== "0" ? value : null;
};
const base = (row: CoolifyResource) => ({
	name: row.name,
	// Coolify container names are not Swarm identities. Use a stable fresh target namespace.
	appName: `coolify-${createHash("sha256").update(row.uuid).digest("hex").slice(0, 16)}`,
	description: coolifyText(row, "description") ?? null,
	memoryLimit: limit(row, "limits_memory"),
	memoryReservation: limit(row, "limits_memory_reservation"),
	cpuLimit: limit(row, "limits_cpus"),
});
const warn = (notes: ImportNote[], service: string, message: string) =>
	notes.push({ level: "warn", service, message });

/** Raw API values are decrypted by Coolify. Quoted/escaped `real_value` is shell output, not data. */
export function coolifyEnv(
	rows: CoolifyRow[],
	field: "env" | "buildArgs" | "previewEnv",
	notes: ImportNote[],
	service: string,
): { value?: string; unavailable: boolean } {
	if (
		field === "previewEnv" &&
		rows.some(
			(row) => row.is_preview === true && row.is_runtime === false && row.is_buildtime === true,
		)
	) {
		warn(
			notes,
			service,
			"Preview build-only variables cannot be represented here; configure preview build behavior manually. Existing target values are kept",
		);
		return { unavailable: true };
	}
	const relevant = rows
		.filter((row) => (field === "previewEnv" ? row.is_preview === true : row.is_preview !== true))
		.filter((row) =>
			field === "buildArgs" ? row.is_buildtime === true : row.is_runtime !== false,
		);
	const values: Record<string, string> = {};
	for (const row of relevant) {
		const key = coolifyText(row, "key");
		const value = coolifyText(row, "value");
		if (
			!key ||
			!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
			value === undefined ||
			row.is_shown_once === true ||
			/\{\{|\r|\n|^enc:v\d+:|^eyJpdiI6|^(['"]).*\1$/.test(value) ||
			value.trim() !== value
		) {
			warn(
				notes,
				service,
				`${field} contains hidden, shared-reference, multiline or unrepresentable values. This entire group was left untouched; replace its values manually before deploying. Existing target values are kept`,
			);
			return { unavailable: true };
		}
		values[key] = value;
	}
	return { value: toEnvString(values), unavailable: false };
}

function domains(
	row: CoolifyRow,
	notes: ImportNote[],
	service: string,
	serviceName?: string,
): { rows: SourceDomain[]; complete: boolean } {
	const result: SourceDomain[] = [];
	let complete = true;
	const exposes =
		obj(row.settings).is_static === true || row.build_pack === "static"
			? "80"
			: (presentText(row, "ports_exposes") ?? presentText(row, "exposes"));
	const firstPort = exposes?.split(",")[0]?.trim();
	for (const entry of (presentText(row, "url") ?? presentText(row, "fqdn") ?? "")
		.split(",")
		.filter(Boolean)) {
		try {
			const url = new URL(entry.trim());
			if (
				!["http:", "https:"].includes(url.protocol) ||
				url.username ||
				url.password ||
				url.search ||
				url.hash
			)
				throw new Error("unsupported domain");
			// URL normalizes :80 / :443 away; preserve an explicit backend-port suffix.
			const explicitPort = /:(\d+)(?:\/|$)/.exec(entry.trim().replace(/^https?:\/\//, ""))?.[1];
			const port = explicitPort
				? Number(explicitPort)
				: firstPort && /^\d+$/.test(firstPort)
					? Number(firstPort)
					: null;
			if (port !== null && (port < 1 || port > 65535)) throw new Error("unsupported port");
			if (port === null) {
				complete = false;
				warn(
					notes,
					service,
					"A domain has no readable backend port; recreate its route manually before deploying. Existing target domains are kept",
				);
				continue;
			}
			result.push({
				host: url.hostname,
				path: url.pathname || "/",
				port,
				https: url.protocol === "https:",
				certificateType: url.protocol === "https:" ? "letsencrypt" : "none",
				...(serviceName ? { serviceName } : {}),
			});
		} catch {
			complete = false;
			warn(
				notes,
				service,
				"A domain uses an unsupported URL format and was skipped; recreate it manually",
			);
		}
	}
	return { rows: result, complete };
}

const unavailableSettings = [
	"server",
	"cpuReservation",
	"registry",
	"pushRegistry",
	"command",
	"replicas",
	"previews",
	"mounts",
	"ports",
	"redirects",
];

export function coolifyApplication(
	row: CoolifyResource,
	envRows: CoolifyRow[],
	notes: ImportNote[],
): SourceApplication {
	const service = `application/${row.name}`;
	const buildPack = presentText(row, "build_pack");
	const isStatic = buildPack === "static" || obj(row.settings).is_static === true;
	if (
		!buildPack ||
		!["dockerimage", "dockerfile", "nixpacks", "railpack", "static"].includes(buildPack)
	) {
		throw badRequest(
			`Coolify application "${row.name}" uses an unsupported build pack; import a Docker image or a supported Git build instead`,
		);
	}
	const image = presentText(row, "docker_registry_image_name");
	const tag = presentText(row, "docker_registry_image_tag");
	let repository = presentText(row, "git_repository");
	if (
		repository &&
		!repository.includes("://") &&
		row.source_id === 0 &&
		coolifyText(row, "source_type")?.endsWith("\\GithubApp")
	)
		repository = `https://github.com/${repository}`;
	if (
		repository &&
		(!/^https?:\/\//.test(repository) ||
			(() => {
				try {
					const u = new URL(repository);
					return !!(u.username || u.password || u.search || u.hash);
				} catch {
					return true;
				}
			})())
	) {
		repository = undefined;
	}
	const unavailableFields = [...unavailableSettings];
	const secrets: Partial<Record<"env" | "buildArgs" | "previewEnv", string>> = {};
	for (const field of ["env", "buildArgs", "previewEnv"] as const) {
		const converted = coolifyEnv(envRows, field, notes, service);
		if (converted.unavailable) unavailableFields.push(field);
		else secrets[field] = converted.value;
	}
	if (buildPack !== "dockerimage" && !repository) {
		warn(
			notes,
			service,
			"The source repository needs manual setup. Reconnect its provider or SSH key and set a credential-free clone URL before deploying",
		);
		unavailableFields.push("gitUrl", "gitBranch");
	}
	if (
		buildPack !== "dockerimage" &&
		presentText(row, "git_commit_sha") &&
		row.git_commit_sha !== "HEAD"
	)
		warn(
			notes,
			service,
			"A pinned Git commit is not carried; the target follows the configured branch. Verify the required revision or deploy an image built from it before cutover",
		);
	if (buildPack !== "dockerimage" && obj(row.settings).is_git_lfs_enabled === true)
		warn(
			notes,
			service,
			"Git LFS configuration is not carried; verify required repository files before deploying",
		);
	if (presentText(row, "dockerfile"))
		warn(
			notes,
			service,
			"An inline Dockerfile is not carried as a file path. Commit it to the repository and select its path before deploying",
		);
	if (
		[
			"install_command",
			"build_command",
			"start_command",
			"pre_deployment_command",
			"post_deployment_command",
			"custom_docker_run_options",
			"custom_nginx_configuration",
		].some((key) => presentText(row, key))
	)
		warn(
			notes,
			service,
			"Custom build/start commands, deploy hooks, Docker options or Nginx configuration are not carried; configure them manually before deploying",
		);
	if (row.is_http_basic_auth_enabled === true)
		warn(
			notes,
			service,
			"HTTP basic auth credentials are not carried; recreate access protection before cutover",
		);
	if (isStatic)
		warn(
			notes,
			service,
			"Static mode imports a prebuilt publish directory; commit generated assets or provide a Dockerfile with the build step before deploying",
		);
	const routed = domains(row, notes, service);
	if (!routed.complete) unavailableFields.push("domains");
	if (routed.rows.length > 0)
		warn(
			notes,
			service,
			"Application domains use the first exposed port when the API hides per-domain port overrides; verify target ports and proxy behavior before cutover",
		);
	return sourceApplicationSchema.parse({
		...base(row),
		applicationId: row.uuid,
		unavailableFields,
		...secrets,
		sourceType: buildPack === "dockerimage" ? "docker" : "git",
		buildType: buildPack === "dockerimage" ? "dockerfile" : isStatic ? "static" : buildPack,
		customGitUrl: buildPack === "dockerimage" ? null : repository,
		customGitBranch: presentText(row, "git_branch") ?? "main",
		buildPath: relative(presentText(row, "base_directory")),
		dockerImage: image
			? image.includes("@") || image.split("/").at(-1)?.includes(":") || !tag
				? image
				: `${image}:${tag}`
			: null,
		dockerfile: relative(presentText(row, "dockerfile_location") ?? "Dockerfile"),
		dockerBuildStage: presentText(row, "dockerfile_target_build"),
		publishDirectory: relative(presentText(row, "publish_directory")),
		isStaticSpa: obj(row.settings).is_spa === true,
		autoDeploy: false,
		enableSubmodules:
			buildPack !== "dockerimage" && obj(row.settings).is_git_submodules_enabled === true,
		watchPaths: presentText(row, "watch_paths")
			?.split(/[\r\n,]+/)
			.map((path) => path.trim())
			.filter(Boolean),
		domains: routed.rows,
	});
}

/** A Coolify service becomes one raw, idle Compose service. */
export function coolifyCompose(
	row: CoolifyResource,
	envRows: CoolifyRow[],
	notes: ImportNote[],
): SourceCompose {
	const service = `compose/${row.name}`;
	const composeFile = presentText(row, "docker_compose_raw");
	if (!composeFile)
		throw badRequest(
			`Coolify Compose content for "${row.name}" is unavailable. Use a read:sensitive API token owned by a team admin, or paste the raw file manually`,
		);
	const converted = coolifyEnv(envRows, "env", notes, service);
	const unavailableFields = ["server", "mounts", "watchPaths", "isolatedDeployment", "suffix"];
	if (converted.unavailable) unavailableFields.push("env");
	const routed: SourceDomain[] = [];
	for (const child of Array.isArray(row.applications) ? row.applications : []) {
		const applicationRow = obj(child);
		const name = presentText(applicationRow, "name");
		if (name) {
			const converted = domains(applicationRow, notes, service, name);
			routed.push(...converted.rows);
			if (!converted.complete) unavailableFields.push("domains");
		}
	}
	warn(
		notes,
		service,
		"Compose is imported as a raw snapshot; repository tracking, external files, volume contents and source proxy settings are not carried. Review its variables, domains and storage before deploying",
	);
	return sourceComposeSchema.parse({
		...base(row),
		composeId: `service:${row.uuid}`,
		unavailableFields,
		sourceType: "raw",
		composeType: "docker-compose",
		composeFile,
		env: converted.value,
		autoDeploy: false,
		domains: routed,
	});
}

const databaseFields: Record<DatabaseServiceKind, { name?: string; user?: string }> = {
	postgres: { name: "postgres_db", user: "postgres_user" },
	mysql: { name: "mysql_database", user: "mysql_user" },
	mariadb: { name: "mariadb_database", user: "mariadb_user" },
	mongo: { name: "mongo_initdb_database", user: "mongo_initdb_root_username" },
	redis: {},
};
export function coolifyDatabase(
	kind: DatabaseServiceKind,
	row: CoolifyResource,
	notes: ImportNote[],
): SourceDatabase {
	const service = `${kind}/${row.name}`;
	const fields = databaseFields[kind];
	const unavailableFields = ["server", "command", "externalPort", "env", "cpuReservation"];
	if (
		row.enable_ssl === true ||
		row.is_public === true ||
		[
			"postgres_conf",
			"mysql_conf",
			"mariadb_conf",
			"mongo_conf",
			"redis_conf",
			"custom_docker_run_options",
		].some((key) => presentText(row, key))
	)
		warn(
			notes,
			service,
			"Database TLS, public ports, tuning and custom Docker options are not carried; configure them manually before restoring data or deploying",
		);
	warn(
		notes,
		service,
		"Database runtime variables are not carried with source credentials; recreate custom variables, restore data separately and update every connection to the target's new credentials",
	);
	return sourceDatabaseSchema.parse({
		...base(row),
		unavailableFields,
		dockerImage: presentText(row, "image"),
		databaseName: fields.name ? presentText(row, fields.name) : undefined,
		databaseUser: fields.user ? presentText(row, fields.user) : undefined,
	});
}
