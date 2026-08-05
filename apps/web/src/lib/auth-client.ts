"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Client for the better-auth instance served at /api/auth (see
 * app/api/auth/[...all]/route.ts). Plugins must mirror the server-side
 * plugins in @nixploy/server (src/lib/auth.ts).
 */
export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
	plugins: [organizationClient(), adminClient(), twoFactorClient(), apiKeyClient()],
});

export const { signIn, signUp, signOut, useSession, organization, twoFactor, apiKey } = authClient;
