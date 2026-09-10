"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { safeNextPath } from "@/lib/safe-next-path";

import { type LoginInput, loginSchema } from "@/server/actions/auth.schema";

export function LoginForm() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const nextPath = safeNextPath(searchParams.get("next"));
	const [formError, setFormError] = useState<string | null>(null);
	const form = useForm<LoginInput>({
		resolver: zodResolver(loginSchema),
		defaultValues: { email: "", password: "" },
	});

	async function onSubmit(values: LoginInput) {
		setFormError(null);
		try {
			const res = await fetch("/api/auth/sign-in/email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: values.email,
					password: values.password,
				}),
			});

			// Better-auth returns JSON. On success it sets the session cookie.
			let data: Record<string, unknown> = {};
			try {
				data = (await res.json()) as Record<string, unknown>;
			} catch {
				// some responses may be empty
			}

			if (!res.ok) {
				const msg = (data as { message?: string }).message ?? `Sign in failed (${res.status})`;
				toast.error(msg);
				setFormError(msg);
				return;
			}

			if ((data as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
				router.push(`/two-factor?next=${encodeURIComponent(nextPath)}`);
				return;
			}

			toast.success("Signed in");
			router.push(nextPath);
			router.refresh();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Network error";
			toast.error(msg);
			setFormError(msg);
		}
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Welcome back</CardTitle>
				<CardDescription>Sign in to your Nixploy instance</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
						{formError && (
							<div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="size-4" />
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
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Password</FormLabel>
									<FormControl>
										<Input type="password" autoComplete="current-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? "Signing in…" : "Sign in"}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
