import type { NixployStack } from "./schema";

export type GitopsPlanAction = "create" | "update" | "noop";

export interface GitopsPlanItem {
	kind: "application" | "compose" | "postgres" | "mysql" | "mariadb" | "mongo" | "redis" | "domain";
	action: GitopsPlanAction;
	name: string;
	environment: string;
	parent?: string;
	changes?: string[];
}

export interface GitopsPlanResult {
	projectId: string;
	environmentName: string;
	items: GitopsPlanItem[];
	summary: { create: number; update: number; noop: number };
}

const stableEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const diffFields = (
	desired: Record<string, unknown>,
	live: Record<string, unknown>,
	fields: string[],
): string[] => {
	const changes: string[] = [];
	for (const field of fields) {
		const desiredValue = desired[field] ?? null;
		const liveValue = live[field] ?? null;
		if (!stableEqual(desiredValue, liveValue)) {
			changes.push(field);
		}
	}
	return changes;
};

const domainKey = (domain: { host: string; path?: string | null; port?: number | null }) =>
	`${domain.host}|${domain.path ?? "/"}|${domain.port ?? ""}`;

const planDomains = (
	_parentKind: "application" | "compose",
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
		const changes = diffFields(domain, existing, [
			"https",
			"certificateType",
			"port",
			"serviceName",
		]);
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
			const changes = diffFields(app, existing.row, [...APPLICATION_FIELDS]);
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
			const changes = diffFields(row, existing.row, [...COMPOSE_FIELDS]);
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
			const changes = diffFields(db, existing.row, [...DATABASE_FIELDS]);
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
		{ create: 0, update: 0, noop: 0 },
	);

	return {
		projectId: live.projectId,
		environmentName,
		items,
		summary,
	};
};
