import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { ORG_ROLE_RANK, type OrgRole, orgRoleRank } from "../projects/roles";

/** Reject invites / role changes that would create a peer or superior. */
export function assertInviteRoleBelowCaller(callerRole: string, inviteRole: string): void {
	const inviteRank =
		ORG_ROLE_RANK[inviteRole as OrgRole] ??
		(() => {
			throw new APIError("BAD_REQUEST", { message: `Unknown role: ${inviteRole}` });
		})();
	if (inviteRank >= orgRoleRank(callerRole)) {
		throw new APIError("FORBIDDEN", {
			message: "Cannot invite or promote a member at or above your own role",
		});
	}
}

export async function loadCallerMembership(userId: string, organizationId: string) {
	const membership = await db.query.members.findFirst({
		where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)),
	});
	if (!membership) {
		throw new APIError("FORBIDDEN", { message: "Not a member of this organization" });
	}
	return membership;
}

export async function assertMemberActionRank(input: {
	actorUserId: string;
	organizationId: string;
	targetMemberRole: string;
	newRole?: string;
}): Promise<void> {
	const caller = await loadCallerMembership(input.actorUserId, input.organizationId);
	const callerRank = orgRoleRank(caller.role);
	if (orgRoleRank(input.targetMemberRole) >= callerRank) {
		throw new APIError("FORBIDDEN", {
			message: "Cannot modify a member at or above your own role",
		});
	}
	if (input.newRole !== undefined) {
		assertInviteRoleBelowCaller(caller.role, input.newRole);
	}
}
