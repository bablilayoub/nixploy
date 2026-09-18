import { z } from "zod";
import { auditFromSession } from "../../modules/audit";
import { assertInstanceAdmin } from "../../modules/auth/instance-admin";
import {
	BRANDING_ASSET_SLOTS,
	clearBrandingAsset,
	loadInstanceBranding,
	publicBranding,
	saveInstanceBranding,
	toPublicBranding,
} from "../../modules/branding";
import { MAX_CUSTOM_CSS_BYTES } from "../../modules/branding/css";
import { resolveCallerOrganizationId } from "../../modules/projects";
import { assertPublicHttpsUrl } from "../../utils/public-url";
import type { TRPCContext } from "../init";
import { protectedProcedure, publicProcedure, router } from "../init";

type Session = NonNullable<TRPCContext["session"]>;

/** Branding is instance-wide — it is on the login page before anyone has an org. */
async function requireInstanceAdmin(session: Session): Promise<string> {
	await assertInstanceAdmin(session);
	return await resolveCallerOrganizationId(session.user.id, session.session.activeOrganizationId);
}

const nullableText = (max: number) => z.string().max(max).nullish();

export const brandingRouter = router({
	/**
	 * What to render. **Public on purpose**: the login page and the setup
	 * wizard need it before a session exists, and it carries nothing an
	 * unauthenticated visitor could not already see by looking at the page.
	 */
	public: publicProcedure.query(async () => publicBranding()),

	/** The stored row, for the settings form. */
	settings: protectedProcedure.query(async ({ ctx }) => {
		await requireInstanceAdmin(ctx.session);
		const row = await loadInstanceBranding();
		return {
			...toPublicBranding(row),
			emailFromName: row?.emailFromName ?? null,
			/** Raw values, so the form shows what is stored rather than the fallback. */
			storedProductName: row?.productName ?? null,
		};
	}),

	update: protectedProcedure
		.input(
			z.object({
				productName: nullableText(80),
				accentColor: z
					.string()
					.regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #4f46e5")
					.nullish(),
				footerText: nullableText(300),
				supportUrl: z.string().url().max(500).nullish(),
				docsUrl: z.string().url().max(500).nullish(),
				emailFromName: nullableText(80),
				customCss: nullableText(MAX_CUSTOM_CSS_BYTES),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			// These become links in the panel's own chrome: an operator pasting a
			// private address would turn "Support" into a probe of the overlay.
			for (const url of [input.supportUrl, input.docsUrl]) {
				if (url) await assertPublicHttpsUrl(url);
			}
			const row = await saveInstanceBranding({
				productName: input.productName?.trim() || null,
				accentColor: input.accentColor ?? null,
				footerText: input.footerText?.trim() || null,
				supportUrl: input.supportUrl ?? null,
				docsUrl: input.docsUrl ?? null,
				emailFromName: input.emailFromName?.trim() || null,
				customCss: input.customCss ?? null,
			});
			void auditFromSession(ctx, organizationId, {
				action: "branding.update",
				targetType: "instanceBranding",
				targetId: row.instanceBrandingId,
				targetName: row.productName,
				// Field names, never the CSS itself: an audit row is not the place
				// for 64 KB of stylesheet.
				metadata: { customCss: Boolean(row.customCss), accentColor: row.accentColor },
			});
			return toPublicBranding(row);
		}),

	/** Remove one uploaded asset (the upload itself is a route handler — it is binary). */
	clearAsset: protectedProcedure
		.input(z.object({ slot: z.enum(BRANDING_ASSET_SLOTS) }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireInstanceAdmin(ctx.session);
			await clearBrandingAsset(input.slot);
			void auditFromSession(ctx, organizationId, {
				action: "branding.clearAsset",
				targetType: "instanceBranding",
				metadata: { slot: input.slot },
			});
			return { slot: input.slot };
		}),
});
