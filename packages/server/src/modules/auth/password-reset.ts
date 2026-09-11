import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { notifications } from "../../db/schema";
import { emailConfigSchema, sendEmailNotification } from "../notifications/providers";

/**
 * Password reset delivery.
 *
 * Nixploy has no instance-level SMTP settings table — email is configured per
 * organization in Settings → Notifications. For the reset flow (which runs
 * before any session exists, so there is no org context) the oldest configured
 * email channel of the instance is used as the transport, with the recipient
 * replaced by the account asking for the reset. Operators who want resets
 * simply add one email notification channel.
 */

export const EMAIL_NOT_CONFIGURED_MESSAGE =
	"Email delivery is not configured on this instance — ask your instance admin to add an email notification channel, or to reset your password for you.";

/** The instance's email transport, or null when none is configured. */
export async function instanceEmailConfig() {
	const [row] = await db
		.select({ emailConfig: notifications.emailConfig, name: notifications.name })
		.from(notifications)
		.where(eq(notifications.type, "email"))
		.orderBy(asc(notifications.createdAt))
		.limit(1);
	if (!row?.emailConfig) return null;
	const parsed = emailConfigSchema.safeParse(row.emailConfig);
	return parsed.success ? parsed.data : null;
}

export async function hasInstanceEmailProvider(): Promise<boolean> {
	return (await instanceEmailConfig()) !== null;
}

/**
 * Absolute panel URL for links inside emails. The request the user made is the
 * most reliable source (they are on the panel right now); env is the fallback
 * for flows without one.
 */
export function panelBaseUrl(request?: Request): string | null {
	const fromRequest = (() => {
		if (!request) return null;
		const origin = request.headers.get("origin")?.trim();
		if (origin) return origin;
		const host = request.headers.get("host")?.trim();
		if (!host) return null;
		const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
		return `${proto}://${host}`;
	})();
	const fromEnv = process.env.BETTER_AUTH_URL?.trim() || process.env.NIXPLOY_BASE_URL?.trim();
	const base = fromRequest || fromEnv || null;
	return base ? base.replace(/\/+$/, "") : null;
}

/** `/reset-password/<token>` on this panel. */
export function resetPasswordUrl(token: string, request?: Request): string {
	const base = panelBaseUrl(request);
	const path = `/reset-password/${encodeURIComponent(token)}`;
	return base ? `${base}${path}` : path;
}

/**
 * Send the reset link. Throws with {@link EMAIL_NOT_CONFIGURED_MESSAGE} when
 * the instance has no email channel — better-auth turns the thrown APIError
 * into the response the forgot-password form shows.
 */
export async function sendPasswordResetEmail(input: {
	email: string;
	name?: string | null;
	token: string;
	request?: Request;
}): Promise<void> {
	const config = await instanceEmailConfig();
	if (!config) {
		throw new Error(EMAIL_NOT_CONFIGURED_MESSAGE);
	}
	const url = resetPasswordUrl(input.token, input.request);
	await sendEmailNotification(
		{ ...config, toAddresses: [input.email] },
		{
			title: "Reset your Nixploy password",
			message: [
				input.name ? `Hi ${input.name},` : "Hi,",
				"",
				"Use the link below to choose a new password. It expires in one hour.",
				"",
				url,
				"",
				"If you did not ask for this, you can ignore this email — your password stays unchanged.",
			].join("\n"),
			fields: [{ name: "Account", value: input.email }],
		},
	);
}
