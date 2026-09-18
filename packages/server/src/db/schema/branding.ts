import { pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, idColumn, updatedAt } from "./utils";

/**
 * Instance whitelabel: one row, or none.
 *
 * Deliberately instance-level rather than per-organization. The surfaces that
 * need it most — the login page, the setup wizard, the favicon, the browser
 * tab title — are rendered before anyone has an organization to look one up
 * from. Per-org accent and display name already exist in
 * `organization.metadata.branding` and still win inside the dashboard.
 *
 * Uploaded files live under `<config>/branding/` and are referenced here by
 * file name only; the column never holds a path, so a crafted value cannot
 * point the asset route somewhere else.
 */
export const instanceBranding = pgTable("instance_branding", {
	instanceBrandingId: idColumn("instance_branding_id"),
	/** Replaces "Nixploy" in the tab title, the shell and transactional email. */
	productName: text("product_name"),
	/** `#rrggbb`; same token set as the per-org accent. */
	accentColor: text("accent_color"),
	/** File names under `<config>/branding/`, not paths. */
	logoLightFile: text("logo_light_file"),
	logoDarkFile: text("logo_dark_file"),
	faviconFile: text("favicon_file"),
	/** Shown under the sign-in card and in the dashboard footer. */
	footerText: text("footer_text"),
	supportUrl: text("support_url"),
	docsUrl: text("docs_url"),
	/** From-name on outbound mail; the address stays the configured sender. */
	emailFromName: text("email_from_name"),
	/**
	 * Operator CSS, sanitised on save. A whitelabel that cannot move a logo two
	 * pixels is not one, and every panel that refuses this grows a fork.
	 */
	customCss: text("custom_css"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});
