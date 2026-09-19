import { relaxesContainerHardening } from "../../utils/swarm-overrides";
import {
	type GitopsApplication,
	type GitopsBasicAuth,
	type GitopsCompose,
	type GitopsDomain,
	type GitopsMount,
	type GitopsPort,
	type GitopsRedirect,
	HOOK_COLUMNS,
	type NixployStack,
	PREVIEW_COLUMNS,
	SWARM_COLUMNS,
} from "./schema";

export type GitopsPlanAction = "create" | "update" | "delete" | "noop";

export type GitopsPlanKind =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "domain"
	| "mount"
	| "port"
	| "redirect"
	| "basicAuth";

export interface GitopsPlanItem {
	kind: GitopsPlanKind;
	action: GitopsPlanAction;
	name: string;
	environment: string;
	parent?: string;
	/** Kind of `parent`; child items only. */
	parentKind?: "application" | "compose";
	changes?: string[];
	/** Set by apply when this item could not be written (others still applied). */
	error?: string;
}

/** What an apply of this plan needs permission for. */
export interface PlanNeeds {
	/** Number of new services the apply would create (quota + `service.create`). */
	creates: number;
	/** Any service or child-row update/delete (`service.write`). */
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
		if (item.parent) {
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

/**
 * What a stack asks for beyond `service.write`, read from the file itself.
 * Conservative on purpose — declaring a bind mount needs the instance admin
 * even when the row already exists, exactly like the panel form does.
 */
export interface StackSensitivity {
	/** Hook commands, basic-auth passwords or file-mount contents (`secrets.write`). */
	secrets: boolean;
	/** Human-readable reasons the instance admin has to run the apply. */
	instanceAdmin: string[];
}

export const stackSensitivity = (stack: NixployStack): StackSensitivity => {
	let secrets = false;
	const instanceAdmin: string[] = [];
	const visit = (label: string, service: GitopsApplication | GitopsCompose) => {
		if (service.hooks && Object.values(service.hooks).some((value) => value !== undefined)) {
			secrets = true;
		}
		if (service.basicAuth?.some((entry) => entry.password !== undefined)) secrets = true;
		if (service.mounts?.some((entry) => entry.content !== undefined)) secrets = true;
		if (service.mounts?.some((entry) => entry.type === "bind")) {
			instanceAdmin.push(`${label}: bind mounts`);
		}
		if ("swarm" in service && service.swarm) {
			const network = service.swarm.network;
			if (Array.isArray(network) && network.length > 0) {
				instanceAdmin.push(`${label}: swarm.network`);
			}
			if (service.swarm.privileges && relaxesContainerHardening(service.swarm.privileges)) {
				instanceAdmin.push(`${label}: swarm.privileges`);
			}
		}
		if ("publishPorts" in service && service.publishPorts === true) {
			instanceAdmin.push(`${label}: publishPorts`);
		}
	};
	for (const app of stack.applications ?? []) visit(`application ${app.name}`, app);
	for (const row of stack.compose ?? []) visit(`compose ${row.name}`, row);
	return { secrets, instanceAdmin };
};

export interface GitopsPlanResult {
	projectId: string;
	environmentName: string;
	items: GitopsPlanItem[];
	summary: { create: number; update: number; delete: number; noop: number };
}

/**
 * Key-order-independent equality. Postgres stores jsonb with its own key
 * order (shortest key first), so a Swarm override read back never matches
 * the manifest's spelling byte for byte — a plain `JSON.stringify` compare
 * reported every apply as a change and redeployed every service.
 */
const canonical = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value as Record<string, unknown>)
				.sort()
				.map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
		);
	}
	return value;
};

const stableEqual = (a: unknown, b: unknown): boolean =>
	JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

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

/** Nested manifest groups, diffed against their row columns as `group.key`. */
const diffGroup = (
	group: string,
	desired: Record<string, unknown> | undefined,
	live: Record<string, unknown>,
	columns: Record<string, string>,
): string[] => {
	if (!desired) return [];
	const changes: string[] = [];
	for (const [key, column] of Object.entries(columns)) {
		const value = desired[key];
		if (value === undefined) continue;
		if (!stableEqual(value ?? null, live[column] ?? null)) {
			changes.push(`${group}.${key}`);
		}
	}
	return changes;
};

// ─── Field lists ─────────────────────────────────────────────────────────────

export const APPLICATION_FIELDS = [
	"description",
	"buildType",
	"sourceType",
	"repository",
	"owner",
	"branch",
	"buildPath",
	"gitUrl",
	"gitBranch",
	"dockerImage",
	"dockerfile",
	"dockerContextPath",
	"dockerBuildStage",
	"useBuildCache",
	"publishDirectory",
	"isStaticSpa",
	"replicas",
	"command",
	"memoryReservation",
	"memoryLimit",
	"cpuReservation",
	"cpuLimit",
	"autoDeploy",
	"autoUpdateImage",
	"watchPaths",
	"registry",
	"pushRegistry",
	"server",
] as const;

export const COMPOSE_FIELDS = [
	"description",
	"composeType",
	"sourceType",
	"composePath",
	"composeFile",
	"repository",
	"owner",
	"branch",
	"gitUrl",
	"gitBranch",
	"autoDeploy",
	"watchPaths",
	"buildEnabled",
	"publishPorts",
	"isolatedDeployment",
	"suffix",
	"server",
] as const;

export const DATABASE_FIELDS = [
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
	"server",
] as const;

/** Row columns the nested groups map to (loaded into `row` by the live state). */
export const APPLICATION_GROUP_COLUMNS = [
	...Object.values(HOOK_COLUMNS),
	...Object.values(SWARM_COLUMNS),
	...Object.values(PREVIEW_COLUMNS),
] as const;

export const COMPOSE_GROUP_COLUMNS = [
	...Object.values(HOOK_COLUMNS),
	...Object.values(PREVIEW_COLUMNS),
] as const;

/** Domain fields diffed per parent kind: `serviceName` only exists on compose domains. */
const DOMAIN_FIELDS: Record<"application" | "compose", readonly string[]> = {
	application: ["https", "certificateType", "port", "internalPath"],
	compose: ["https", "certificateType", "port", "serviceName", "internalPath"],
};

// ─── Live shapes ─────────────────────────────────────────────────────────────

export interface LiveMiddleware {
	kind: string;
	config: unknown;
	enabled: boolean;
}

export interface LiveDomain {
	host: string;
	path?: string | null;
	port?: number | null;
	https?: boolean;
	certificateType?: string;
	serviceName?: string | null;
	internalPath?: string | null;
	middlewares?: LiveMiddleware[];
}

export interface LiveMount {
	type: "bind" | "volume" | "file";
	mountPath: string;
	hostPath: string | null;
	volumeName: string | null;
	filePath: string | null;
	/** `undefined` when the caller may not read file contents. */
	content?: string | null;
	serviceName: string | null;
}

export interface LivePort {
	published: number;
	target: number;
	protocol: "tcp" | "udp";
	publishMode: "ingress" | "host";
}

export interface LiveRedirect {
	regex: string;
	replacement: string;
	permanent: boolean;
	serviceName: string | null;
}

export interface LiveBasicAuth {
	username: string;
	serviceName: string | null;
}

export interface LiveService {
	name: string;
	appName: string;
	row: Record<string, unknown>;
	domains: LiveDomain[];
	mounts?: LiveMount[];
	ports?: LivePort[];
	redirects?: LiveRedirect[];
	basicAuth?: LiveBasicAuth[];
}

export interface LiveStackState {
	projectId: string;
	environmentName: string;
	applications: LiveService[];
	compose: LiveService[];
	databases: {
		postgres: Array<{ name: string; row: Record<string, unknown> }>;
		mysql: Array<{ name: string; row: Record<string, unknown> }>;
		mariadb: Array<{ name: string; row: Record<string, unknown> }>;
		mongo: Array<{ name: string; row: Record<string, unknown> }>;
		redis: Array<{ name: string; row: Record<string, unknown> }>;
	};
}

// ─── Keys ────────────────────────────────────────────────────────────────────

export const domainKey = (domain: { host: string; path?: string | null; port?: number | null }) =>
	`${domain.host}|${domain.path ?? "/"}|${domain.port ?? ""}`;

export const mountKey = (mount: { mountPath: string; serviceName?: string | null }) =>
	`${mount.serviceName ?? ""}|${mount.mountPath}`;

export const portKey = (port: { published: number; protocol?: "tcp" | "udp" | null }) =>
	`${port.published}/${port.protocol ?? "tcp"}`;

export const redirectKey = (redirect: { regex: string; serviceName?: string | null }) =>
	`${redirect.serviceName ?? ""}|${redirect.regex}`;

export const basicAuthKey = (entry: { username: string; serviceName?: string | null }) =>
	`${entry.serviceName ?? ""}|${entry.username}`;

const domainLabel = (domain: { host: string; path?: string | null }) =>
	`${domain.host}${domain.path && domain.path !== "/" ? domain.path : ""}`;

/** A middleware chain reduced to what the manifest can express. */
export const normalizeMiddlewares = (
	chain: Array<{ kind: string; config?: unknown; enabled?: boolean }> | undefined,
): LiveMiddleware[] =>
	(chain ?? []).map((entry) => ({
		kind: entry.kind,
		config: entry.config ?? {},
		enabled: entry.enabled ?? true,
	}));

// ─── Collections ─────────────────────────────────────────────────────────────

/**
 * Reconcile one child collection: desired rows keyed by `key` are created,
 * compared on `fields`, or left alone; live rows the manifest does not list
 * are deleted. `extra` lets a collection add changes a field list cannot
 * express (the domain middleware chain).
 */
const planCollection = <D extends object, L extends object>(input: {
	kind: GitopsPlanKind;
	parent: string;
	parentKind: "application" | "compose";
	environment: string;
	desired: D[] | undefined;
	live: L[];
	key: (row: D | L) => string;
	label: (row: D | L) => string;
	fields: readonly string[];
	extra?: (desired: D, live: L) => string[];
}): GitopsPlanItem[] => {
	// An omitted collection leaves the live rows alone.
	if (input.desired === undefined) return [];
	const items: GitopsPlanItem[] = [];
	const liveByKey = new Map(input.live.map((row) => [input.key(row), row]));
	for (const desired of input.desired) {
		const key = input.key(desired);
		const existing = liveByKey.get(key);
		const name = input.label(desired);
		if (!existing) {
			items.push({
				kind: input.kind,
				action: "create",
				name,
				environment: input.environment,
				parent: input.parent,
				parentKind: input.parentKind,
			});
			continue;
		}
		const changes = [
			...diffFields(
				desired as Record<string, unknown>,
				existing as Record<string, unknown>,
				input.fields,
			),
			...(input.extra?.(desired, existing) ?? []),
		];
		items.push({
			kind: input.kind,
			action: changes.length > 0 ? "update" : "noop",
			name,
			environment: input.environment,
			parent: input.parent,
			parentKind: input.parentKind,
			changes: changes.length > 0 ? changes : undefined,
		});
		liveByKey.delete(key);
	}
	for (const leftover of liveByKey.values()) {
		items.push({
			kind: input.kind,
			action: "delete",
			name: input.label(leftover),
			environment: input.environment,
			parent: input.parent,
			parentKind: input.parentKind,
		});
	}
	return items;
};

const planDomains = (
	parentKind: "application" | "compose",
	parentName: string,
	environmentName: string,
	desired: GitopsDomain[] | undefined,
	live: LiveDomain[],
): GitopsPlanItem[] =>
	planCollection<GitopsDomain, LiveDomain>({
		kind: "domain",
		parent: parentName,
		parentKind,
		environment: environmentName,
		desired,
		live,
		key: domainKey,
		label: domainLabel,
		fields: DOMAIN_FIELDS[parentKind],
		extra: (wanted, existing) =>
			wanted.middlewares !== undefined &&
			!stableEqual(
				normalizeMiddlewares(wanted.middlewares),
				normalizeMiddlewares(existing.middlewares),
			)
				? ["middlewares"]
				: [],
	});

const planMounts = (
	parentKind: "application" | "compose",
	parentName: string,
	environmentName: string,
	desired: GitopsMount[] | undefined,
	live: LiveMount[],
): GitopsPlanItem[] =>
	planCollection<GitopsMount, LiveMount>({
		kind: "mount",
		parent: parentName,
		parentKind,
		environment: environmentName,
		desired,
		live,
		key: mountKey,
		label: (row) => (row.serviceName ? `${row.serviceName}:${row.mountPath}` : row.mountPath),
		fields: ["type", "hostPath", "volumeName", "filePath"],
		// Content is compared only when the manifest carries it AND the live
		// state could read it; a caller without `secrets.read` sees `undefined`
		// on the live side and must not report a change it cannot verify.
		extra: (wanted, existing) =>
			wanted.content !== undefined &&
			existing.content !== undefined &&
			(wanted.content ?? "") !== (existing.content ?? "")
				? ["content"]
				: [],
	});

const planPorts = (
	parentKind: "application" | "compose",
	parentName: string,
	environmentName: string,
	desired: GitopsPort[] | undefined,
	live: LivePort[],
): GitopsPlanItem[] =>
	planCollection<GitopsPort, LivePort>({
		kind: "port",
		parent: parentName,
		parentKind,
		environment: environmentName,
		desired,
		live,
		key: portKey,
		label: (row) => `${row.published}→${row.target}/${row.protocol ?? "tcp"}`,
		fields: ["target", "publishMode"],
	});

const planRedirects = (
	parentKind: "application" | "compose",
	parentName: string,
	environmentName: string,
	desired: GitopsRedirect[] | undefined,
	live: LiveRedirect[],
): GitopsPlanItem[] =>
	planCollection<GitopsRedirect, LiveRedirect>({
		kind: "redirect",
		parent: parentName,
		parentKind,
		environment: environmentName,
		desired,
		live,
		key: redirectKey,
		label: (row) => (row.serviceName ? `${row.serviceName}:${row.regex}` : row.regex),
		fields: ["replacement", "permanent"],
	});

const planBasicAuth = (
	parentKind: "application" | "compose",
	parentName: string,
	environmentName: string,
	desired: GitopsBasicAuth[] | undefined,
	live: LiveBasicAuth[],
): GitopsPlanItem[] =>
	planCollection<GitopsBasicAuth, LiveBasicAuth>({
		kind: "basicAuth",
		parent: parentName,
		parentKind,
		environment: environmentName,
		desired,
		live,
		key: basicAuthKey,
		label: (row) => (row.serviceName ? `${row.serviceName}:${row.username}` : row.username),
		fields: [],
		// A stored password is a bcrypt hash; a manifest that carries one
		// cannot be compared, so it is always written.
		extra: (wanted) => (wanted.password !== undefined ? ["password"] : []),
	});

const planChildren = (
	parentKind: "application" | "compose",
	desired: GitopsApplication | GitopsCompose,
	environmentName: string,
	live: LiveService | undefined,
): GitopsPlanItem[] => [
	...planDomains(parentKind, desired.name, environmentName, desired.domains, live?.domains ?? []),
	...planMounts(parentKind, desired.name, environmentName, desired.mounts, live?.mounts ?? []),
	...("ports" in desired
		? planPorts(parentKind, desired.name, environmentName, desired.ports, live?.ports ?? [])
		: []),
	...planRedirects(
		parentKind,
		desired.name,
		environmentName,
		desired.redirects,
		live?.redirects ?? [],
	),
	...planBasicAuth(
		parentKind,
		desired.name,
		environmentName,
		desired.basicAuth,
		live?.basicAuth ?? [],
	),
];

/** Changes on the service row itself: flat fields plus the nested groups. */
export const diffApplication = (desired: GitopsApplication, live: Record<string, unknown>) => [
	...diffFields(desired, live, APPLICATION_FIELDS),
	...diffGroup("hooks", desired.hooks, live, HOOK_COLUMNS),
	...diffGroup("swarm", desired.swarm, live, SWARM_COLUMNS),
	...diffGroup("previews", desired.previews, live, PREVIEW_COLUMNS),
];

export const diffCompose = (desired: GitopsCompose, live: Record<string, unknown>) => [
	...diffFields(desired, live, COMPOSE_FIELDS),
	...diffGroup("hooks", desired.hooks, live, HOOK_COLUMNS),
	...diffGroup("previews", desired.previews, live, PREVIEW_COLUMNS),
];

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
			const changes = diffApplication(app, existing.row);
			items.push({
				kind: "application",
				action: changes.length > 0 ? "update" : "noop",
				name: app.name,
				environment: environmentName,
				changes: changes.length > 0 ? changes : undefined,
			});
		}
		items.push(...planChildren("application", app, environmentName, existing));
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
			const changes = diffCompose(row, existing.row);
			items.push({
				kind: "compose",
				action: changes.length > 0 ? "update" : "noop",
				name: row.name,
				environment: environmentName,
				changes: changes.length > 0 ? changes : undefined,
			});
		}
		items.push(...planChildren("compose", row, environmentName, existing));
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
