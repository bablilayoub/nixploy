import { z } from "zod";

/**
 * Client-safe environment. Only NEXT_PUBLIC_* vars may live here — anything
 * server-only (DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY) belongs to
 * `@nixploy/server` once it exists. See .env.example.
 */
const envSchema = z.object({
	NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
});

export const env = envSchema.parse({
	NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
