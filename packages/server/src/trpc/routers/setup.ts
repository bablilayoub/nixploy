import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hasInstanceEmailProvider } from "../../modules/auth/password-reset";
import { getInvitationPreview, needsSetup, requiresSetupToken } from "../../modules/auth/setup";
import { publicSsoInfo } from "../../modules/auth/sso";
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
		return {
			needsSetup: await needsSetup(),
			// The installer writes NIXPLOY_SETUP_TOKEN and prints it with the URL;
			// the wizard then shows a token field (or reads ?token=).
			requiresSetupToken: requiresSetupToken(),
		};
	}),

	/**
	 * What the sign-in surfaces need before a session exists: whether SSO is
	 * configured (and its button label) and whether password reset can send
	 * mail at all. Deliberately a server-side probe so no `NEXT_PUBLIC_*` URL
	 * or provider secret reaches the client bundle.
	 */
	authConfig: publicProcedure.query(async ({ ctx }) => {
		const ip = clientIpFromRequest(new Request("http://local", { headers: ctx.headers }));
		if (!takeIpRateLimitToken("auth-config", ip, { windowMs: 60_000, max: 60 })) {
			throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests" });
		}
		const sso = publicSsoInfo();
		return {
			sso,
			passwordResetAvailable: await hasInstanceEmailProvider(),
		};
	}),

	/**
	 * Preview a pending invitation by id (no session). Used by the
	 * shareable accept-invitation link — no SMTP involved. The invitee's
	 * address comes back masked: a leaked link must not disclose it.
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
