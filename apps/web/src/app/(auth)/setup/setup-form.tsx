"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";
import { type RegisterInput, setupSchema } from "@/server/actions/auth.schema";

/**
 * First-boot onboarding: create the instance owner when zero users exist.
 * Public /register is removed; this is the only self-serve signup path.
 */
export function SetupForm() {
	const router = useRouter();
	const trpc = useTRPC();
	const [formError, setFormError] = useState<string | null>(null);

	const status = useQuery(trpc.setup.needsSetup.queryOptions());

	useEffect(() => {
		if (status.data && !status.data.needsSetup) {
			router.replace("/login");
		}
	}, [status.data, router]);

	const form = useForm<RegisterInput>({
		resolver: zodResolver(setupSchema),
		defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
	});

	async function onSubmit(values: RegisterInput) {
		setFormError(null);
		try {
			const signupRes = await fetch("/api/auth/sign-up/email", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({
					name: values.name.trim(),
					email: values.email,
					password: values.password,
				}),
			});
			const signup = (await signupRes.json()) as { message?: string };
			if (!signupRes.ok) {
				const msg = signup.message ?? `Setup failed (${signupRes.status})`;
				toast.error(msg);
				setFormError(msg);
				return;
			}

			// crypto.randomUUID is missing on non-secure HTTP (common for first
			// install via http://server-ip:3000). Fall back for the org slug.
			const suffix =
				typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
					? crypto.randomUUID().slice(0, 8)
					: Math.random().toString(36).slice(2, 10);
			const slug = `personal-${suffix}`;
			const orgRes = await fetch("/api/auth/organization/create", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({ name: `${values.name.trim()}'s Org`, slug }),
			});
			const org = (await orgRes.json()) as { id?: string; message?: string } | null;
			if (!orgRes.ok || !org?.id) {
				const msg = org?.message ?? "Failed to create organization";
				toast.error(msg);
				setFormError(msg);
				return;
			}

			const setRes = await fetch("/api/auth/organization/set-active", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({ organizationId: org.id }),
			});
			if (!setRes.ok) {
				const setData = (await setRes.json()) as { message?: string };
				toast.error(setData.message ?? "Failed to activate organization");
				return;
			}

			toast.success("Instance ready");
			router.push("/dashboard");
			router.refresh();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Network error";
			toast.error(msg);
			setFormError(msg);
		}
	}

	if (status.isPending) {
		return (
			<Card>
				<CardHeader className="text-center">
					<Skeleton className="mx-auto h-7 w-48" />
					<Skeleton className="mx-auto mt-2 h-4 w-64" />
				</CardHeader>
				<CardContent className="grid gap-4">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (status.data && !status.data.needsSetup) {
		return null;
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Welcome to Nixploy</CardTitle>
				<CardDescription>
					Create the owner account for this server. Public registration stays closed after this.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
						{formError && (
							<div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="size-4 shrink-0" />
								{formError}
							</div>
						)}
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input placeholder="Ada Lovelace" autoComplete="name" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
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
										<Input type="password" autoComplete="new-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="confirmPassword"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Confirm password</FormLabel>
									<FormControl>
										<Input type="password" autoComplete="new-password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
							{form.formState.isSubmitting ? "Setting up…" : "Create owner account"}
						</Button>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
