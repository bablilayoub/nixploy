import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	memberAc,
	ownerAc,
} from "better-auth/plugins/organization/access";

export const orgAc = createAccessControl(defaultStatements);

/** Read-only org membership — Nixploy gates writes in tRPC via assertOrgRole. */
export const orgViewerRole = orgAc.newRole({
	organization: [],
	member: [],
	invitation: [],
	team: [],
	ac: [],
});

/** Can deploy services; same better-auth permissions as member. */
export const orgDeployerRole = orgAc.newRole({
	organization: [],
	member: [],
	invitation: [],
	team: [],
	ac: ["read"],
});

export const orgPluginRoles = {
	owner: ownerAc,
	admin: adminAc,
	member: memberAc,
	deployer: orgDeployerRole,
	viewer: orgViewerRole,
} as const;
