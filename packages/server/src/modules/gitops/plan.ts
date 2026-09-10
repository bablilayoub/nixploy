import type { NixployStack } from "./schema";

export type GitopsPlanAction = "create" | "update" | "delete" | "noop";

export interface GitopsPlanItem {
	kind: "application" | "compose" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis" | "domain";
	action: GitopsPlanAction;
	name: string;
	environment: string;
	parent?: string;
	changes?: string[];
	/** Set by apply when this item could not be written (others still applied). */
	error?: string;
}

/** What an apply of this plan needs permission for (service items only; domains ride on their parent). */
export interface PlanNeeds {
	/** Number of new services the apply would create (quota + `service.create`). */
	creates: number;
	/** Any service or domain update/delete (`service.write`). */
	writes: boolean;
	/** Applications/compose that would be redeployed (`service.deploy`). */
	redeploys: number;
}

export const summarizePlanNeeds = (plan: GitopsPlanResult): PlanNeeds => {
	let creates = 0;
	let writes = false;
	let redeploys = 0;
	for (const item of plan.items) {
		if (item.action === "noop") continue;
		if (item.kind === "domain") {
			writes = true;
			continue;
		}
		if (item.action === "create") creates += 1;
		else writes = true;
		if (
			(item.kind === "application" || item.kind === "compose") &&
			(item.action === "create" || (item.changes?.length ?? 0) > 0)
		) {
			redeploys += 1;
		}
	}
	return { creates, writes, redeploys };
};

export interface GitopsPlanResult {
	projectId: string;
	environmentName: string;
	items: GitopsPlanItem[];
	summary: { create: number; update: number; delete: number; noop: number };
}

const stableEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Fields the manifest actually sets (`undefined` = "leave as is", never
 * "reset to null"): a hand-written manifest listing only `repository` and
 * `branch` must not diff every omitted column against the DB defaults, or
 * every apply would report — and redeploy — unchanged services.
 */
export const diffFields = (
	desired: Record<string, unknown>,
	live: Record<string, unknown>,
	fields: readonly string[],
): string[] => {
	const changes: string[] = [];
	for (const field of fields) {
		if (!(field in desired) || desired[field] === undefined) continue;
		const desiredValue = desired[field] ?? null;
		const liveValue = live[field] ?? null;
		if (!stableEqual(desiredValue, liveValue)) {
			changes.push(field);
		}
	}
	return changes;
};

/** Domain fields diffed per parent kind: `serviceName` only exists on compose domains. */
const DOMAIN_FIELDS: Record<"application" | "compose", readonly string[]> = {
	application: ["https", "certificateType", "port"],
	compose: ["https", "certificateType", "port", "serviceName"],
};

const domainKey = (domain: { host: string; path?: string | null; port?: number | null }) =>
	`${domain.host}|${domain.path ?? "/"}|${domain.port ?? ""}`;

const planDomains = (
	parentKind: "application" | "compose",
	parentName: string,
	environmentName: string,
	desired: Array<{
		host: string;
		path?: string | null;
		port?: number | null;
		https?: boolean;
		certificateType?: string;
		serviceName?: string | null;
	}> = [],
	live: Array<{
		host: string;
		path?: string | null;
		port?: number | null;
		https?: boolean;
		certificateType?: string;
		serviceName?: string | null;
	}> = [],
): GitopsPlanItem[] => {
	const items: GitopsPlanItem[] = [];
	const liveByKey = new Map(live.map((row) => [domainKey(row), row]));

	for (const domain of desired) {
		const key = domainKey(domain);
		const existing = liveByKey.get(key);
		const label = `${domain.host}${domain.path && domain.path !== "/" ? domain.path : ""}`;
		if (!existing) {
			items.push({
				kind: "domain",
				action: "create",
				name: label,
				environment: environmentName,
				parent: parentName,
			});
			continue;
		}
		const changes = diffFields(domain, existing, DOMAIN_FIELDS[parentKind]);
		items.push({
			kind: "domain",
			action: changes.length > 0 ? "update" : "noop",
			name: label,
			environment: environmentName,
			parent: parentName,
			changes: changes.length > 0 ? changes : undefined,
		});
		liveByKey.delete(key);
	}

	// Live domains absent from the desired stack are removed on apply.
	for (const leftover of liveByKey.values()) {
		const label = `${leftover.host}${leftover.path && leftover.path !== "/" ? leftover.path : ""}`;
		items.push({
			kind: "domain",
			action: "delete",
			name: label,
			environment: environmentName,
			parent: parentName,
		});
	}

	return items;
};

const APPLICATION_FIELDS = [
	"description",
	"buildType",
	"sourceType",
	"repository",
	"owner",
	"branch",
	"buildPath",
	"dockerImage",
	"replicas",
	"command",
	"memoryReservation",
	"memoryLimit",
	"cpuReservation",
	"cpuLimit",
	"autoDeploy",
	"dockerfile",
] as const;

const COMPOSE_FIELDS = [
	"description",
	"composeType",
	"sourceType",
	"composePath",
	"composeFile",
	"repository",
	"owner",
	"branch",
	"autoDeploy",
] as const;

const DATABASE_FIELDS = [
	"description",
	"dockerImage",
	"externalPort",
	"command",
	"memoryReservation",
	"memoryLimit",
	"cpuReservation",
	"cpuLimit",
	"databaseName",
	"databaseUser",
] as const;

export interface LiveStackState {
	projectId: string;
	environmentName: string;
	applications: Array<{
		name: string;
		appName: string;
		row: Record<string, unknown>;
		domains: Array<Record<string, unknown>>;
	}>;
	compose: Array<{
		name: string;
		appName: string;
		row: Record<string, unknown>;
		domains: Array<Record<string, unknown>>;
	}>;
	databases: {
		postgres: Array<{ name: string; row: Record<string, unknown> }>;
		mysql: Array<{ name: string; row: Record<string, unknown> }>;
		mariadb: Array<{ name: string; row: Record<string, unknown> }>;
		mongo: Array<{ name: string; row: Record<string, unknown> }>;
		redis: Array<{ name: string; row: Record<string, unknown> }>;
	};
}

export const buildPlan = (desired: NixployStack, live: LiveStackState): GitopsPlanResult => {
	const items: GitopsPlanItem[] = [];
	const environmentName = live.environmentName;

	for (const app of desired.applications ?? []) {
		if (app.environment !== environmentName) continue;
		const existing = live.applications.find((row) => row.name === app.name);
		if (!existing) {
			items.push({
				kind: "application",
				action: "create",
				name: app.name,
				environment: environmentName,
			});
		} else {
			const changes = diffFields(app, existing.row, APPLICATION_FIELDS);
			items.push({
				kind: "application",
				action: changes.length > 0 ? "update" : "noop",
				name: app.name,
				environment: environmentName,
				changes: changes.length > 0 ? changes : undefined,
			});
		}
		items.push(
			...planDomains(
				"application",
				app.name,
				environmentName,
				app.domains,
				existing?.domains as
					| Array<{
							host: string;
							path?: string | null;
							port?: number | null;
							https?: boolean;
							certificateType?: string;
							serviceName?: string | null;
					  }>
					| undefined,
			),
		);
	}

	for (const row of desired.compose ?? []) {
		if (row.environment !== environmentName) continue;
		const existing = live.compose.find((entry) => entry.name === row.name);
		if (!existing) {
			items.push({
				kind: "compose",
				action: "create",
				name: row.name,
				environment: environmentName,
			});
		} else {
			const changes = diffFields(row, existing.row, COMPOSE_FIELDS);
			items.push({
				kind: "compose",
				action: changes.length > 0 ? "update" : "noop",
				name: row.name,
				environment: environmentName,
				changes: changes.length > 0 ? changes : undefined,
			});
		}
		items.push(
			...planDomains(
				"compose",
				row.name,
				environmentName,
				row.domains,
				existing?.domains as
					| Array<{
							host: string;
							path?: string | null;
							port?: number | null;
							https?: boolean;
							certificateType?: string;
							serviceName?: string | null;
					  }>
					| undefined,
			),
		);
	}

	const databaseKinds = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;
	for (const kind of databaseKinds) {
		for (const db of desired.databases?.[kind] ?? []) {
			if (db.environment !== environmentName) continue;
			const existing = live.databases[kind].find((entry) => entry.name === db.name);
			if (!existing) {
				items.push({
					kind,
					action: "create",
					name: db.name,
					environment: environmentName,
				});
				continue;
			}
			const changes = diffFields(db, existing.row, DATABASE_FIELDS);
			items.push({
				kind,
				action: changes.length > 0 ? "update" : "noop",
				name: db.name,
				environment: environmentName,
				changes: changes.length > 0 ? changes : undefined,
			});
		}
	}

	const summary = items.reduce(
		(acc, item) => {
			acc[item.action] += 1;
			return acc;
		},
		{ create: 0, update: 0, delete: 0, noop: 0 },
	);

	return {
		projectId: live.projectId,
		environmentName,
		items,
		summary,
	};
};
