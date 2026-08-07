/** Org membership role ladder used by better-auth AC and capability defaults. */
export type OrgRole = "viewer" | "member" | "deployer" | "admin" | "owner";

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
	viewer: 0,
	member: 1,
	deployer: 2,
	admin: 3,
	owner: 4,
};

/** Rank for a stored member role string; unknown values fall back to viewer. */
export function orgRoleRank(role: string): number {
	const parts = role
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	let max = ORG_ROLE_RANK.viewer;
	let matched = false;
	for (const part of parts) {
		const rank = ORG_ROLE_RANK[part as OrgRole];
		if (rank !== undefined) {
			matched = true;
			if (rank > max) max = rank;
		}
	}
	return matched ? max : ORG_ROLE_RANK.viewer;
}
