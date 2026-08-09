import { z } from "zod";

/**
 * Validation schemas for the auth forms (login / register / two-factor).
 * Submission goes through the better-auth client (src/lib/auth-client.ts).
 */
export const loginSchema = z.object({
	email: z.email("Enter a valid email address"),
	password: z.string().min(1, "Password is required"),
});

export const registerSchema = z
	.object({
		name: z.string().min(1, "Name is required").max(64),
		email: z.email("Enter a valid email address"),
		password: z.string().min(8, "Password must be at least 8 characters"),
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

/** Alias used by the first-admin onboarding form (owner account step). */
export const setupSchema = registerSchema;

/** Organization name collected on the setup wizard org step. */
export const setupOrgSchema = z.object({
	orgName: z.string().min(1, "Organization name is required").max(64),
});

/**
 * Build a unique org slug from a display name. Uses crypto.randomUUID when
 * available; falls back for non-secure HTTP (common on first install via IP).
 */
export function buildOrgSlug(orgName: string): string {
	const base =
		orgName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "org";
	const suffix =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(36).slice(2, 10);
	return `${base}-${suffix}`;
}

export const twoFactorSchema = z.object({
	code: z.string().length(6, "Enter the 6-digit code"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type SetupInput = RegisterInput;
export type SetupOrgInput = z.infer<typeof setupOrgSchema>;
export type TwoFactorInput = z.infer<typeof twoFactorSchema>;
