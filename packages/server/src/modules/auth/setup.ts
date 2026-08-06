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

/**
 * Whether email may sign up: only the first user, or someone with a pending
 * organization invitation (Settings → invite).
 */
export async function canSignUpEmail(email: string): Promise<boolean> {
	if (!(await hasAnyUsers())) return true;
	const normalized = email.trim().toLowerCase();
	if (!normalized) return false;
	const [invite] = await db
		.select({ id: invitations.id })
		.from(invitations)
		.where(sql`lower(${invitations.email}) = ${normalized} and ${invitations.status} = 'pending'`)
		.limit(1);
	return Boolean(invite);
}

/**
 * Public, unauthenticated preview of a pending invitation for the accept page.
 * Returns null when missing, expired, or already used — callers should not
 * distinguish those cases to the invitee beyond "invalid or expired".
 */
export async function getInvitationPreview(invitationId: string): Promise<{
	invitationId: string;
	email: string;
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
		email: invitation.email,
		role: invitation.role,
		expiresAt: invitation.expiresAt,
		organizationName: organization.name,
	};
}
