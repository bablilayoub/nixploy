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

/** Alias used by the first-admin onboarding form. */
export const setupSchema = registerSchema;

export const twoFactorSchema = z.object({
	code: z.string().length(6, "Enter the 6-digit code"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type SetupInput = RegisterInput;
export type TwoFactorInput = z.infer<typeof twoFactorSchema>;
