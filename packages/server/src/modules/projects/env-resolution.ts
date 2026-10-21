import { eq } from "drizzle-orm";
import { type DbExecutor, db } from "../../db";
import { environments, projects } from "../../db/schema";
import { notFound } from "../errors";
import { mergeEnv, parseEnv, toEnvString } from "./env-values";
import { loadOrganizationEnvironment } from "./organization-env";

export { mergeEnv, mergeEnvStrings, parseEnv, toEnvString } from "./env-values";

export interface EnvironmentLayers {
	organization: string;
	project: string;
	environment: string;
}

export type VariableOrigin = keyof EnvironmentLayers | "service";

/** One parser and precedence chain for previews, hooks, Compose and runtime specs. */
export function resolveEnvironmentLayers(
	layers: EnvironmentLayers,
	serviceEnv = "",
): { values: Record<string, string>; origins: Record<string, VariableOrigin> } {
	let values: Record<string, string> = {};
	const origins: Record<string, VariableOrigin> = {};
	const sources: Array<[VariableOrigin, string]> = [
		["organization", layers.organization],
		["project", layers.project],
		["environment", layers.environment],
		["service", serviceEnv],
	];
	for (const [origin, text] of sources) {
		const parsed = parseEnv(text);
		values = mergeEnv(values, parsed);
		for (const key of Object.keys(parsed)) origins[key] = origin;
	}
	return { values, origins };
}

/** Internal helper; routers must authorize the environment before calling. */
export async function loadEnvironmentLayers(
	environmentId: string,
	executor: DbExecutor = db,
): Promise<EnvironmentLayers> {
	const [row] = await executor
		.select({
			environmentEnv: environments.env,
			projectEnv: projects.env,
			organizationId: projects.organizationId,
		})
		.from(environments)
		.innerJoin(projects, eq(environments.projectId, projects.projectId))
		.where(eq(environments.environmentId, environmentId))
		.limit(1);
	if (!row) throw notFound(`Environment ${environmentId} not found`);
	return {
		organization: await loadOrganizationEnvironment(row.organizationId, executor),
		project: row.projectEnv ?? "",
		environment: row.environmentEnv ?? "",
	};
}

export async function resolveEnvironmentVariables(
	environmentId: string,
	executor: DbExecutor = db,
): Promise<Record<string, string>> {
	return resolveEnvironmentLayers(await loadEnvironmentLayers(environmentId, executor)).values;
}

export async function resolveRuntimeEnvironment(
	environmentId: string,
	serviceEnv: string | null,
	executor: DbExecutor = db,
): Promise<string> {
	const resolved = resolveEnvironmentLayers(
		await loadEnvironmentLayers(environmentId, executor),
		serviceEnv ?? "",
	);
	return toEnvString(resolved.values);
}
