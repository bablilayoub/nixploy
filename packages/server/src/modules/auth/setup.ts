import { timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import { invitations, organizations, users } from "../../db/schema";

/** True when the instance has at least one user row. */
export async function hasAnyUsers(): Promise<boolean> {
	const [row] = await db.select({ value: count() }).from(users);
	return Number(row?.value ?? 0) > 0;
}

/** True when the instance still needs the first admin account. */
export async function needsSetup(): Promise<boolean> {
	return !(await hasAnyUsers());
}

/** Header the accept-invitation page sends with the sign-up request. */
export const INVITATION_ID_HEADER = "x-nixploy-invitation-id";

// ── first-admin setup token ─────────────────────────────────────────────────

/** Header the setup wizard sends with the first-admin sign-up request. */
export const SETUP_TOKEN_HEADER = "x-nixploy-setup-token";

/**
 * When `NIXPLOY_SETUP_TOKEN` is set the first-admin claim at `/setup` is no
 * longer "first visitor wins": the installer prints a random token, writes it
 * to `/etc/nixploy/.env`, and the operator opens `/setup?token=<token>` (or
 * pastes it into the form). Unset (upgrades, dev) keeps the old behaviour.
 */
export function setupToken(): string | null {
	const value = process.env.NIXPLOY_SETUP_TOKEN?.trim();
	return value && value.length > 0 ? value : null;
}

/** True when this instance requires a setup token for the first admin. */
export function requiresSetupToken(): boolean {
	return setupToken() !== null;
}

/** Constant-time comparison of a caller-supplied token against the configured one. */
export function setupTokenMatches(candidate: string | null | undefined): boolean {
	const expected = setupToken();
	if (!expected) return true;
	const provided = candidate?.trim() ?? "";
	if (provided.length === 0) return false;
	const expectedBuffer = Buffer.from(expected, "utf8");
	const providedBuffer = Buffer.from(provided, "utf8");
	if (expectedBuffer.length !== providedBuffer.length) return false;
	return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Mask an email for unauthenticated display: enough for the invitee to
 * recognise their own address, not enough to harvest it from a leaked link.
 * `ada.lovelace@example.com` → `ad•••••••••@example.com`.
 */
export function maskEmail(email: string): string {
	const trimmed = email.trim();
	const at = trimmed.lastIndexOf("@");
	if (at <= 0) return "•••";
	const local = trimmed.slice(0, at);
	const domain = trimmed.slice(at);
	const visible = local.slice(0, Math.min(2, local.length));
	return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}${domain}`;
}

/**
 * Whether `email` may sign up through invitation `invitationId`: the
 * invitation must exist, be pending and unexpired, and be addressed to that
 * email. Binding the sign-up to a specific invitation id (rather than "any
 * pending invitation for this email") means only whoever holds the invite
 * link can register the invitee's address.
 */
export async function canSignUpWithInvitation(
	email: string,
	invitationId: string | null | undefined,
): Promise<boolean> {
	const normalized = email.trim().toLowerCase();
	const id = invitationId?.trim();
	if (!normalized || !id) return false;
	const [invite] = await db
		.select({ id: invitations.id })
		.from(invitations)
		.where(
			and(
				eq(invitations.id, id),
				sql`lower(${invitations.email}) = ${normalized}`,
				eq(invitations.status, "pending"),
				gt(invitations.expiresAt, new Date()),
			),
		)
		.limit(1);
	return Boolean(invite);
}

/**
 * Public, unauthenticated preview of a pending invitation for the accept page.
 * Returns null when missing, expired, or already used — callers should not
 * distinguish those cases to the invitee beyond "invalid or expired".
 *
 * The invitee's address is returned **masked**: anyone who finds or receives a
 * leaked invite link must not learn the full email (security audit 2.2). The
 * accept page asks the invitee to type their address instead; sign-up verifies
 * it against the invitation (`canSignUpWithInvitation`).
 */
export async function getInvitationPreview(invitationId: string): Promise<{
	invitationId: string;
	emailMasked: string;
	role: string | null;
	expiresAt: Date;
	organizationName: string;
} | null> {
	const invitation = await db.query.invitations.findFirst({
		where: and(
			eq(invitations.id, invitationId),
			eq(invitations.status, "pending"),
			gt(invitations.expiresAt, new Date()),
		),
	});
	if (!invitation) return null;

	const organization = await db.query.organizations.findFirst({
		where: eq(organizations.id, invitation.organizationId),
	});
	if (!organization) return null;

	return {
		invitationId: invitation.id,
		emailMasked: maskEmail(invitation.email),
		role: invitation.role,
		expiresAt: invitation.expiresAt,
		organizationName: organization.name,
	};
}
