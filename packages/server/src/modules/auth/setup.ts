import { count, sql } from "drizzle-orm";
import { db } from "../../db";
import { invitations, users } from "../../db/schema";

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
