import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";
import { forbidden } from "../errors";

/** better-auth admin plugin: first user gets `role: "admin"` on the user row. */
export function isInstanceAdminRole(role: string | null | undefined): boolean {
	if (!role) return false;
	return role
		.split(",")
		.map((part) => part.trim())
		.includes("admin");
}

/**
 * Platform-wide actions (self-update, Traefik host, AI singleton, docker cleanup
 * cron) must not be available to every org admin — only instance admins.
 */
export async function assertInstanceAdmin(session: {
	user: { id: string; role?: string | null };
}): Promise<void> {
	let role = session.user.role;
	if (role == null) {
		const row = await db.query.users.findFirst({
			where: eq(users.id, session.user.id),
			columns: { role: true },
		});
		role = row?.role ?? null;
	}
	if (!isInstanceAdminRole(role)) {
		throw forbidden("This action requires the instance admin role");
	}
}
