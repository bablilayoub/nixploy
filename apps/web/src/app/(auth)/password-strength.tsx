"use client";

import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Password guidance for every "choose a new password" surface (setup,
 * invitation, reset). Deliberately dependency-free — length plus character
 * classes, no zxcvbn bundle — and advisory beyond the hard minimum the server
 * enforces (`emailAndPassword.minPasswordLength` in packages/server/src/lib/auth.ts).
 */

/** Hard floor better-auth rejects below. Keep in sync with `minPasswordLength`. */
export const MIN_PASSWORD_LENGTH = 12;

interface Rule {
	id: string;
	label: string;
	test: (value: string) => boolean;
}

const RULES: Rule[] = [
	{
		id: "length",
		label: `At least ${MIN_PASSWORD_LENGTH} characters`,
		test: (value) => value.length >= MIN_PASSWORD_LENGTH,
	},
	{ id: "case", label: "Upper and lower case", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
	{ id: "digit", label: "A number", test: (value) => /\d/.test(value) },
	{ id: "symbol", label: "A symbol", test: (value) => /[^\w\s]/.test(value) },
];

export type PasswordStrength = "weak" | "fair" | "strong";

/** How many of the advisory rules a candidate satisfies. */
export function passwordScore(value: string): number {
	return RULES.filter((rule) => rule.test(value)).length;
}

export function passwordStrength(value: string): PasswordStrength {
	const score = passwordScore(value);
	if (score <= 2) return "weak";
	if (score === 3) return "fair";
	return "strong";
}

const STRENGTH_LABEL: Record<PasswordStrength, string> = {
	weak: "Weak",
	fair: "Fair",
	strong: "Strong",
};

const STRENGTH_BAR: Record<PasswordStrength, string> = {
	weak: "w-1/3 bg-destructive",
	fair: "w-2/3 bg-warning",
	strong: "w-full bg-success",
};

const STRENGTH_TEXT: Record<PasswordStrength, string> = {
	weak: "text-destructive",
	fair: "text-warning",
	strong: "text-success",
};

/** Meter + checklist. Renders nothing until the field has content. */
export function PasswordStrengthHint({ value }: { value: string }) {
	if (!value) return null;
	const strength = passwordStrength(value);

	return (
		<div className="grid gap-2" aria-live="polite">
			<div className="flex items-center gap-2">
				<div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
					<div className={cn("h-full rounded-full transition-all", STRENGTH_BAR[strength])} />
				</div>
				<span className={cn("text-xs font-medium", STRENGTH_TEXT[strength])}>
					{STRENGTH_LABEL[strength]}
				</span>
			</div>
			<ul className="grid gap-1">
				{RULES.map((rule) => {
					const passed = rule.test(value);
					return (
						<li
							key={rule.id}
							className={cn(
								"flex items-center gap-1.5 text-xs",
								passed ? "text-muted-foreground" : "text-muted-foreground/70",
							)}
						>
							{passed ? (
								<Check className="size-3 shrink-0 text-success" />
							) : (
								<X className="size-3 shrink-0" />
							)}
							{rule.label}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
