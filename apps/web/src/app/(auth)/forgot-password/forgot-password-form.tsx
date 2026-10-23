"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { describeError } from "@/lib/describe-error";

const forgotSchema = z.object({
	email: z.email("Enter a valid email address"),
});

type ForgotInput = z.infer<typeof forgotSchema>;

/**
 * Password reset request. better-auth answers the same way whether or not the
 * address exists (no account enumeration) — except when the instance has no
 * email channel at all, where the operator needs to know that resets cannot
 * be delivered instead of waiting for a mail that will never arrive.
 */
export function ForgotPasswordForm() {
	const [formError, setFormError] = useState<string | null>(null);
	const [sent, setSent] = useState(false);
	const form = useForm<ForgotInput>({
		resolver: zodResolver(forgotSchema),
		defaultValues: { email: "" },
	});

	async function onSubmit(values: ForgotInput) {
		setFormError(null);
		try {
			const res = await fetch("/api/auth/request-password-reset", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({
					email: values.email,
					redirectTo: `${window.location.origin}/reset-password`,
				}),
			});
			let data: { message?: string } = {};
			try {
				data = (await res.json()) as { message?: string };
			} catch {
				// empty body on success
			}
			if (!res.ok) {
				const message = data.message ?? `Could not send the reset email (${res.status})`;
				toast.error(message);
				setFormError(message);
				return;
			}
			setSent(true);
		} catch (err) {
			const message = describeError(err, "Network error");
			toast.error(message);
			setFormError(message);
		}
	}

	if (sent) {
		return (
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="flex items-center justify-center gap-2 text-xl">
						<MailCheck className="size-5" />
						Check your inbox
					</CardTitle>
					<CardDescription>
						If an account exists for that address, a reset link is on its way. It expires in one
						hour.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild variant="outline" className="w-full">
						<Link href="/login">Back to sign in</Link>
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Forgot your password?</CardTitle>
				<CardDescription>
					We will email you a link to choose a new one. Your instance must have an email
					notification channel configured.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
						{formError && (
							<div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="mt-0.5 size-4 shrink-0" />
								{formError}
							</div>
						)}
						<FormField
							control={form.control}
							name="email"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Email</FormLabel>
									<FormControl>
										<Input
											type="email"
											placeholder="you@example.com"
											autoComplete="email"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? "Sending…" : "Send reset link"}
						</Button>
						<Button asChild variant="ghost" className="w-full">
							<Link href="/login">Back to sign in</Link>
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
