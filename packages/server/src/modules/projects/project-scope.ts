import { AsyncLocalStorage } from "node:async_hooks";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { members, projects, teamMembers, teamProjects, teams } from "../../db/schema";
import { notFound } from "../errors";

/**
 * Project-level access.
 *
 * An organization role says *what* a member may do. A team says *where*: a
 * member whose `project_scope` is `teams` can only see and touch the projects
 * their teams are attached to, and a member in no team sees nothing.
 *
 * The filter travels in an `AsyncLocalStorage` store rather than through every
 * signature, for the same reason `CapabilityScope` does: the tenancy funnels
 * (`findProjectById`, `assertApplicationAccess`, `getServiceContext`, …) are
 * called from well over a hundred places that have a project in hand but no
 * request handle. `protectedProcedure` enters the store once per request.
 *
 * **Absence of a store means unrestricted.** Crons, the deploy worker, webhook
 * handlers and boot recovery all run outside a request and must keep seeing
 * every project; the restriction is a property of a *caller*, and the store is
 * how a caller is described. Deny-by-default lives in the filter itself — a
 * `teams` member with no team resolves to an empty allow-list — not in whether
 * somebody remembered to enter the store.
 */

/** How a member's project access is decided. */
export const PROJECT_SCOPES = ["organization", "teams"] as const;
export type ProjectScopeKind = (typeof PROJECT_SCOPES)[number];

export const isProjectScopeKind = (value: unknown): value is ProjectScopeKind =>
	typeof value === "string" && (PROJECT_SCOPES as readonly string[]).includes(value);

/** Which projects a caller may reach. */
export type ProjectFilter =
	| { kind: "all" }
	/** Exactly these project ids; an empty set means none. */
	| { kind: "projects"; projectIds: ReadonlySet<string> };

export const ALL_PROJECTS: ProjectFilter = { kind: "all" };

/* -------------------------------------------------------------------------- */
/*  Resolving                                                                 */
/* -------------------------------------------------------------------------- */

/** One membership row, reduced to what the decision needs. */
export type MembershipScope = { organizationId: string; projectScope: string | null };

/**
 * Split a user's memberships into the organizations that constrain them and
 * the ones that do not.
 */
export function membershipScopes(memberships: readonly MembershipScope[]): {
	open: string[];
	scoped: string[];
} {
	const open: string[] = [];
	const scoped: string[] = [];
	for (const membership of memberships) {
		(membership.projectScope === "teams" ? scoped : open).push(membership.organizationId);
	}
	return { open, scoped };
}

/**
 * Pure half: the filter for a user, given which organizations constrain them
 * and every project id they can reach.
 *
 * "No constraining organization" is the overwhelmingly common case and means
 * unrestricted — a caller pays one indexed read and nothing else. Once even one
 * membership is teams-scoped the filter becomes an allow-list, which is why the
 * ids of the *unconstrained* organizations have to be in it too.
 */
export function projectFilterFor(
	scopedOrganizationIds: readonly string[],
	reachableProjectIds: readonly string[],
): ProjectFilter {
	if (scopedOrganizationIds.length === 0) return ALL_PROJECTS;
	return { kind: "projects", projectIds: new Set(reachableProjectIds) };
}

/**
 * Per-request cache, keyed by the session object the tRPC context carries —
 * the same trick `getOrganizationId` uses, so a batched request resolves the
 * filter once rather than once per procedure.
 */
const filterBySession = new WeakMap<object, Promise<ProjectFilter>>();

/** {@link resolveProjectFilter}, memoized for the lifetime of one session object. */
export function resolveProjectFilterForSession(
	session: object,
	userId: string,
): Promise<ProjectFilter> {
	const cached = filterBySession.get(session);
	if (cached) return cached;
	const promise = resolveProjectFilter(userId);
	filterBySession.set(session, promise);
	return promise;
}

/**
 * The filter for one user, across every organization they belong to.
 *
 * Deliberately **not** parameterised by an organization. The active
 * organization is resolved lazily by the routers that need it
 * (`ctx.organizationId()`), and forcing it here would make every protected
 * procedure — including the ones with no organization at all — pay for it.
 * Taking the union over memberships is also the honest answer while a session
 * can switch organizations mid-flight, and it stays fail-closed: the
 * organization check in each tenancy funnel is unchanged and still
 * authoritative, so a project id in this set is necessary, never sufficient.
 */
export async function resolveProjectFilter(userId: string): Promise<ProjectFilter> {
	const memberships = await db
		.select({ organizationId: members.organizationId, projectScope: members.projectScope })
		.from(members)
		.where(eq(members.userId, userId));

	const { open, scoped } = membershipScopes(memberships);
	if (scoped.length === 0) return ALL_PROJECTS;

	const memberOf = new Set(memberships.map((membership) => membership.organizationId));

	const [teamRows, openRows] = await Promise.all([
		db
			.select({ projectId: teamProjects.projectId, organizationId: teams.organizationId })
			.from(teamProjects)
			.innerJoin(teamMembers, eq(teamMembers.teamId, teamProjects.teamId))
			.innerJoin(teams, eq(teams.teamId, teamProjects.teamId))
			.where(eq(teamMembers.userId, userId)),
		// Organizations this user is *not* scoped in still show every project,
		// so their ids have to join the allow-list.
		open.length > 0
			? db
					.select({ projectId: projects.projectId })
					.from(projects)
					.where(inArray(projects.organizationId, open))
			: Promise.resolve([] as Array<{ projectId: string }>),
	]);

	// A `team_member` row outlives the organization membership it was created
	// under (it references the user, not the member row), so intersect with the
	// memberships we just read rather than trusting the join alone.
	const reachable = [
		...teamRows.filter((row) => memberOf.has(row.organizationId)).map((row) => row.projectId),
		...openRows.map((row) => row.projectId),
	];
	return projectFilterFor(scoped, reachable);
}

/* -------------------------------------------------------------------------- */
/*  The per-request store                                                     */
/* -------------------------------------------------------------------------- */

const projectFilterStorage = new AsyncLocalStorage<ProjectFilter>();

/** The filter in force for the current request, if any. */
export const currentProjectFilter = (): ProjectFilter | undefined =>
	projectFilterStorage.getStore();

/** Run `fn` with a project filter in force. */
export function runWithProjectFilter<T>(filter: ProjectFilter, fn: () => T): T {
	return projectFilterStorage.run(filter, fn);
}

/** Whether the current caller may reach this project. */
export function isProjectVisible(projectId: string): boolean {
	const filter = projectFilterStorage.getStore();
	if (!filter || filter.kind === "all") return true;
	return filter.projectIds.has(projectId);
}

/**
 * Refuse a project the caller cannot reach.
 *
 * **Not found, not forbidden.** A member scoped to their own team must not be
 * able to learn that another project exists by watching an error code change,
 * so a project they cannot reach is indistinguishable from one that is not
 * there — the same contract `assertApplicationAccess` already keeps across
 * organizations.
 */
export function assertProjectVisible(projectId: string, label = "Project"): void {
	if (!isProjectVisible(projectId)) {
		throw notFound(`${label} not found`);
	}
}

/**
 * Narrow a list of project ids to the visible ones. For the list procedures,
 * which filter in SQL or in memory rather than throwing.
 */
export function visibleProjectIds(projectIds: readonly string[]): string[] {
	const filter = projectFilterStorage.getStore();
	if (!filter || filter.kind === "all") return [...projectIds];
	return projectIds.filter((projectId) => filter.projectIds.has(projectId));
}

/**
 * A `where` fragment restricting a column of project ids, or undefined when
 * the caller may see everything. `and(...)` ignores an undefined member, so a
 * call site reads the same either way.
 *
 * An empty allow-list yields `inArray(column, [])`, which drizzle renders as a
 * contradiction — the important half of deny-by-default.
 */
export function projectIdFilter(column: Parameters<typeof inArray>[0]) {
	const filter = projectFilterStorage.getStore();
	if (!filter || filter.kind === "all") return undefined;
	return inArray(column, [...filter.projectIds]);
}
