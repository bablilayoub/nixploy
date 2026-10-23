"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

import { MIN_PASSWORD_LENGTH, PasswordStrengthHint } from "../../password-strength";

const resetSchema = z
	.object({
		password: z
			.string()
			.min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
		confirmPassword: z.string(),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type ResetInput = z.infer<typeof resetSchema>;

/** Choose a new password from an emailed link (`/reset-password/<token>`). */
export function ResetPasswordForm({ token }: { token: string }) {
	const router = useRouter();
	const [formError, setFormError] = useState<string | null>(null);
	const form = useForm<ResetInput>({
		resolver: zodResolver(resetSchema),
		defaultValues: { password: "", confirmPassword: "" },
	});
	const password = form.watch("password");

	async function onSubmit(values: ResetInput) {
		setFormError(null);
		try {
			const res = await fetch("/api/auth/reset-password", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({ newPassword: values.password, token }),
			});
			let data: { message?: string } = {};
			try {
				data = (await res.json()) as { message?: string };
			} catch {
				// empty body on success
			}
			if (!res.ok) {
				const message = data.message ?? `This reset link is invalid or has expired (${res.status})`;
				toast.error(message);
				setFormError(message);
				return;
			}
			toast.success("Password changed — sign in with your new password");
			router.push("/login");
			router.refresh();
		} catch (err) {
			const message = describeError(err, "Network error");
			toast.error(message);
			setFormError(message);
		}
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Choose a new password</CardTitle>
				<CardDescription>
					Reset links expire one hour after they are sent and can only be used once.
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
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>New password</FormLabel>
									<FormControl>
										<Input type="password" autoComplete="new-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<PasswordStrengthHint value={password} />
						<FormField
							control={form.control}
							name="confirmPassword"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Confirm new password</FormLabel>
									<FormControl>
										<Input type="password" autoComplete="new-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? "Saving…" : "Set new password"}
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
