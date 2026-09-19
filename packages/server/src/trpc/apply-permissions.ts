import { TRPCError } from "@trpc/server";
import { assertInstanceAdmin } from "../modules/auth/instance-admin";
import {
	type NixployStack,
	planStack,
	stackSensitivity,
	summarizePlanNeeds,
} from "../modules/gitops";
import {
	assertCapability,
	getOrganizationServiceStatusCounts,
	getOrgQuotas,
} from "../modules/projects";
import type { TRPCContext } from "./init";

type Session = NonNullable<TRPCContext["session"]>;

/**
 * Applying a manifest is a compound mutation: on top of `gitops.manage` the
 * caller needs the same per-action capabilities the normal routers gate on —
 * `service.create` (+ the service quota) for every service the plan would
 * create, `service.write` for updates, `service.deploy` when the changed
 * applications/compose get redeployed, `secrets.write` when the file carries
 * hook commands, basic-auth passwords or file-mount contents, and the
 * instance admin for what the panel forms reserve for it (bind mounts,
 * Swarm network/privilege overrides, publishing compose ports). The plan is
 * computed against the live state before anything is written. Shared by the
 * GitOps router and the importer, which is a GitOps apply from another panel.
 */
export async function assertApplyPermissions(
	session: Session,
	organizationId: string,
	stack: NixployStack,
	projectId: string | undefined,
	redeploy: boolean,
	includeSensitive: boolean,
	/** Skip the diff when the target does not exist yet — every service is a create. */
	knownCreates?: number,
): Promise<void> {
	const sensitivity = stackSensitivity(stack);
	if (sensitivity.secrets) {
		await assertCapability(session.user.id, organizationId, "secrets.write");
	}
	if (sensitivity.instanceAdmin.length > 0) {
		await assertInstanceAdmin(session);
	}
	const needs =
		knownCreates === undefined
			? summarizePlanNeeds(await planStack(stack, organizationId, projectId, { includeSensitive }))
			: { creates: knownCreates, writes: false, redeploys: 0 };
	if (needs.creates > 0) {
		await assertCapability(session.user.id, organizationId, "service.create");
		const quotas = await getOrgQuotas(organizationId);
		if (quotas.maxServices != null) {
			const counts = await getOrganizationServiceStatusCounts(organizationId);
			if (counts.total + needs.creates > quotas.maxServices) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Service limit reached (${quotas.maxServices} max; this apply would create ${needs.creates})`,
				});
			}
		}
	}
	if (needs.writes) {
		await assertCapability(session.user.id, organizationId, "service.write");
	}
	if (redeploy && needs.redeploys > 0) {
		await assertCapability(session.user.id, organizationId, "service.deploy");
	}
}
