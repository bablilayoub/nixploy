import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getInvitationPreview, needsSetup } from "../../modules/auth/setup";
import { clientIpFromRequest, takeIpRateLimitToken } from "../../utils/rate-limit";
import { publicProcedure, router } from "../init";

/**
 * Public setup probes used by /setup, /login, and /accept-invitation before
 * any session exists.
 */
export const setupRouter = router({
	/** Whether the instance has zero users and needs the first admin. */
	needsSetup: publicProcedure.query(async ({ ctx }) => {
		const ip = clientIpFromRequest(new Request("http://local", { headers: ctx.headers }));
		if (!takeIpRateLimitToken("needs-setup", ip, { windowMs: 60_000, max: 60 })) {
			throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
		}
		return { needsSetup: await needsSetup() };
	}),

	/**
	 * Preview a pending invitation by id (no session). Used by the
	 * shareable accept-invitation link — no SMTP involved.
	 */
	invitationPreview: publicProcedure
		.input(z.object({ invitationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const ip = clientIpFromRequest(new Request("http://local", { headers: ctx.headers }));
			if (!takeIpRateLimitToken("invitation-preview", ip, { windowMs: 60_000, max: 30 })) {
				throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
			}
			const preview = await getInvitationPreview(input.invitationId);
			if (!preview) {
				return { ok: false as const };
			}
			return { ok: true as const, invitation: preview };
		}),
});
