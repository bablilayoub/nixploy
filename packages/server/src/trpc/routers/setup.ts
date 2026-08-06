import { z } from "zod";
import { getInvitationPreview, needsSetup } from "../../modules/auth/setup";
import { publicProcedure, router } from "../init";

/**
 * Public setup probes used by /setup, /login, and /accept-invitation before
 * any session exists.
 */
export const setupRouter = router({
	/** Whether the instance has zero users and needs the first admin. */
	needsSetup: publicProcedure.query(async () => {
		return { needsSetup: await needsSetup() };
	}),

	/**
	 * Preview a pending invitation by id (no session). Used by the
	 * shareable accept-invitation link — no SMTP involved.
	 */
	invitationPreview: publicProcedure
		.input(z.object({ invitationId: z.string().min(1) }))
		.query(async ({ input }) => {
			const preview = await getInvitationPreview(input.invitationId);
			if (!preview) {
				return { ok: false as const };
			}
			return { ok: true as const, invitation: preview };
		}),
});
