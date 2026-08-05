import "server-only";

import { auth } from "@nixploy/server/auth";
import { headers } from "next/headers";

/**
 * Server-side session helpers for route handlers, layouts and server
 * components. The middleware only checks for the presence of the session
 * cookie — this is the authoritative check.
 */
export async function getSession() {
	return auth.api.getSession({ headers: await headers() });
}
