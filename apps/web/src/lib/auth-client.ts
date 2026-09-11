"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { orgAc, orgPluginRoles } from "@nixploy/server/lib/org-roles";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Client for the better-auth instance served at /api/auth (see
 * app/api/auth/[...all]/route.ts). Plugins must mirror the server-side
 * plugins in @nixploy/server (src/lib/auth.ts).
 *
 * No baseURL: the client always talks to the origin the page was loaded
 * from. A build-time NEXT_PUBLIC_* URL would be baked into the Docker image
 * and point at the wrong host (e.g. localhost) in production.
 */
export const authClient = createAuthClient({
	plugins: [
		organizationClient({ ac: orgAc, roles: orgPluginRoles }),
		adminClient(),
		twoFactorClient(),
		apiKeyClient(),
	],
});

export const { signOut, useSession } = authClient;
