import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Project scoping. The interesting half is deny-by-default: a member who is
 * teams-scoped and in no team must resolve to an empty allow-list, never to
 * "all", and a project outside the list must be indistinguishable from one
 * that does not exist.
 */

/** Rows the fake database answers with, set per test. */
const rows = {
	memberships: [] as Array<{ organizationId: string; projectScope: string | null }>,
	teamProjects: [] as Array<{ projectId: string; organizationId: string }>,
	openProjects: [] as Array<{ projectId: string }>,
};

/**
 * Minimal drizzle-shaped select. `resolveProjectFilter` issues exactly three
 * shapes of query, distinguished by which table `.from()` names.
 */
const fakeDb = {
	select: () => ({
		from: (table: { _: { name?: string } } & Record<string, unknown>) => {
			const name = tableName(table);
			const chain = {
				innerJoin: () => chain,
				where: async () => {
					if (name === "member") return rows.memberships;
					if (name === "team_project") return rows.teamProjects;
					return rows.openProjects;
				},
			};
			return chain;
		},
	}),
};

/** Drizzle keeps the SQL name on a private symbol; read it defensively. */
function tableName(table: object): string {
	for (const symbol of Object.getOwnPropertySymbols(table)) {
		if (String(symbol).includes("Name")) {
			const value = (table as Record<symbol, unknown>)[symbol];
			if (typeof value === "string") return value;
		}
	}
	return "";
}

vi.mock("../../db", () => ({ db: fakeDb }));

const {
	ALL_PROJECTS,
	assertProjectVisible,
	currentProjectFilter,
	isProjectVisible,
	membershipScopes,
	projectFilterFor,
	projectIdFilter,
	resolveProjectFilter,
	runWithProjectFilter,
	visibleProjectIds,
} = await import("./project-scope");
const { projects } = await import("../../db/schema");

beforeEach(() => {
	rows.memberships = [];
	rows.teamProjects = [];
	rows.openProjects = [];
});

describe("membershipScopes", () => {
	it("splits the organizations that constrain the user from the ones that do not", () => {
		expect(
			membershipScopes([
				{ organizationId: "org_a", projectScope: "organization" },
				{ organizationId: "org_b", projectScope: "teams" },
				{ organizationId: "org_c", projectScope: null },
			]),
		).toEqual({ open: ["org_a", "org_c"], scoped: ["org_b"] });
	});
});

describe("projectFilterFor", () => {
	it("is unrestricted when no organization constrains the user", () => {
		expect(projectFilterFor([], ["project_1"])).toBe(ALL_PROJECTS);
	});

	it("is an allow-list as soon as one organization does", () => {
		const filter = projectFilterFor(["org_b"], ["project_1", "project_2"]);
		expect(filter.kind).toBe("projects");
		expect([...(filter as { projectIds: ReadonlySet<string> }).projectIds].sort()).toEqual([
			"project_1",
			"project_2",
		]);
	});

	it("denies everything for a teams-scoped member with no team", () => {
		const filter = projectFilterFor(["org_b"], []);
		expect(filter).toEqual({ kind: "projects", projectIds: new Set() });
	});
});

describe("resolveProjectFilter", () => {
	it("stays unrestricted — and asks one question — when no membership is teams-scoped", async () => {
		rows.memberships = [{ organizationId: "org_a", projectScope: "organization" }];
		await expect(resolveProjectFilter("user_1")).resolves.toBe(ALL_PROJECTS);
	});

	it("unions the team's projects with every project of the unscoped organizations", async () => {
		rows.memberships = [
			{ organizationId: "org_a", projectScope: "teams" },
			{ organizationId: "org_b", projectScope: "organization" },
		];
		rows.teamProjects = [{ projectId: "project_a1", organizationId: "org_a" }];
		rows.openProjects = [{ projectId: "project_b1" }, { projectId: "project_b2" }];

		const filter = await resolveProjectFilter("user_1");
		expect(filter.kind).toBe("projects");
		expect([...(filter as { projectIds: ReadonlySet<string> }).projectIds].sort()).toEqual([
			"project_a1",
			"project_b1",
			"project_b2",
		]);
	});

	it("ignores team rows from an organization the user has left", async () => {
		// `team_member` references the user, not the membership row, so it
		// outlives a removal from the organization.
		rows.memberships = [{ organizationId: "org_a", projectScope: "teams" }];
		rows.teamProjects = [
			{ projectId: "project_a1", organizationId: "org_a" },
			{ projectId: "project_gone", organizationId: "org_former" },
		];

		const filter = await resolveProjectFilter("user_1");
		expect(filter).toEqual({ kind: "projects", projectIds: new Set(["project_a1"]) });
	});

	it("denies everything when the only membership is teams-scoped and teamless", async () => {
		rows.memberships = [{ organizationId: "org_a", projectScope: "teams" }];
		await expect(resolveProjectFilter("user_1")).resolves.toEqual({
			kind: "projects",
			projectIds: new Set(),
		});
	});

	it("does not constrain a user with no membership at all", async () => {
		// Nothing to narrow, and the organization check every funnel already
		// runs is what refuses them. Answering "all" here keeps first-run setup
		// and the background roles working.
		await expect(resolveProjectFilter("user_1")).resolves.toBe(ALL_PROJECTS);
	});
});

describe("the per-request store", () => {
	it("treats the absence of a store as unrestricted, so crons keep working", () => {
		expect(currentProjectFilter()).toBeUndefined();
		expect(isProjectVisible("project_1")).toBe(true);
		expect(() => assertProjectVisible("project_1")).not.toThrow();
		expect(projectIdFilter(projects.projectId)).toBeUndefined();
		expect(visibleProjectIds(["project_1"])).toEqual(["project_1"]);
	});

	it("narrows inside the store and survives an await", async () => {
		const filter = { kind: "projects", projectIds: new Set(["project_1"]) } as const;
		await runWithProjectFilter(filter, async () => {
			await Promise.resolve();
			expect(currentProjectFilter()).toBe(filter);
			expect(isProjectVisible("project_1")).toBe(true);
			expect(isProjectVisible("project_2")).toBe(false);
			expect(visibleProjectIds(["project_1", "project_2"])).toEqual(["project_1"]);
			expect(projectIdFilter(projects.projectId)).toBeDefined();
		});
		expect(currentProjectFilter()).toBeUndefined();
	});

	it("answers NOT_FOUND for a hidden project, never FORBIDDEN", () => {
		runWithProjectFilter({ kind: "projects", projectIds: new Set() }, () => {
			try {
				assertProjectVisible("project_1", "Application");
				throw new Error("expected a rejection");
			} catch (error) {
				expect(error).toMatchObject({ code: "NOT_FOUND", message: "Application not found" });
			}
		});
	});

	it("still emits a contradiction for an empty allow-list", () => {
		runWithProjectFilter({ kind: "projects", projectIds: new Set() }, () => {
			// `inArray(column, [])` is what makes deny-by-default reach SQL.
			expect(projectIdFilter(projects.projectId)).toBeDefined();
		});
	});
});
