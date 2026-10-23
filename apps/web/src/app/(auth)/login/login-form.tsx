"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Fingerprint, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useBranding } from "@/components/branding-provider";
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
import { authClient } from "@/lib/auth-client";
import { describeError } from "@/lib/describe-error";
import { safeNextPath } from "@/lib/safe-next-path";

import { type LoginInput, loginSchema } from "@/server/actions/auth.schema";

export interface SsoProviderInfo {
	providerId: string;
	name: string;
	preset: string;
}

export function LoginForm({
	ssoProviders = [],
	passkeysAvailable = false,
}: {
	ssoProviders?: SsoProviderInfo[];
	/** False when the panel has no domain — WebAuthn has nothing to bind to. */
	passkeysAvailable?: boolean;
}) {
	const router = useRouter();
	const branding = useBranding();
	const searchParams = useSearchParams();
	const nextPath = safeNextPath(searchParams.get("next"));
	const [formError, setFormError] = useState<string | null>(null);
	/** The provider a redirect is in flight for; disables every button. */
	const [ssoPending, setSsoPending] = useState<string | null>(null);
	const [passkeyPending, setPasskeyPending] = useState(false);

	/**
	 * Sign in with a passkey.
	 *
	 * No email first: the credential identifies the account, which is the point
	 * — a discoverable credential means the browser offers the accounts it holds
	 * for this domain and the server learns who it is from the assertion.
	 */
	async function signInWithPasskey() {
		setFormError(null);
		setPasskeyPending(true);
		try {
			const { error } = await authClient.signIn.passkey();
			if (error) {
				setFormError(describeError(error));
				return;
			}
			router.push(nextPath);
			router.refresh();
		} catch (error) {
			// The browser throws rather than returning when the user dismisses the
			// system sheet. That is a cancellation, not a failure to report.
			if (error instanceof DOMException && error.name === "NotAllowedError") return;
			setFormError(describeError(error));
		} finally {
			setPasskeyPending(false);
		}
	}
	const form = useForm<LoginInput>({
		resolver: zodResolver(loginSchema),
		defaultValues: { email: "", password: "" },
	});

	/**
	 * OIDC sign-in. `genericOAuth` registers the provider as a social provider,
	 * so this is the standard /sign-in/social route; the response carries the
	 * authorization URL to send the browser to.
	 */
	async function signInWithSso(provider: SsoProviderInfo) {
		setFormError(null);
		setSsoPending(provider.providerId);
		try {
			const res = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({
					provider: provider.providerId,
					callbackURL: nextPath,
					errorCallbackURL: "/login",
				}),
			});
			const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
			if (!res.ok || !data.url) {
				const msg = data.message ?? `Could not start ${provider.name} sign-in (${res.status})`;
				toast.error(msg);
				setFormError(msg);
				return;
			}
			window.location.href = data.url;
		} catch (err) {
			const msg = describeError(err, "Network error");
			toast.error(msg);
			setFormError(msg);
		} finally {
			setSsoPending(null);
		}
	}

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
			const msg = describeError(err, "Network error");
			toast.error(msg);
			setFormError(msg);
		}
	}

	return (
		<Card>
			<CardHeader className="text-center">
				<CardTitle className="text-xl">Welcome back</CardTitle>
				<CardDescription>Sign in to your {branding.productName} instance</CardDescription>
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
						<Link
							href="/forgot-password"
							className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
						>
							Forgot your password?
						</Link>
					</form>
				</Form>

				{(ssoProviders.length > 0 || passkeysAvailable) && (
					<div className="mt-4 grid gap-4">
						<div className="flex items-center gap-3">
							<span className="h-px flex-1 bg-border" />
							<span className="text-xs text-muted-foreground">or</span>
							<span className="h-px flex-1 bg-border" />
						</div>
						{passkeysAvailable && (
							<Button
								type="button"
								variant="outline"
								className="w-full"
								disabled={passkeyPending || ssoPending !== null}
								onClick={() => void signInWithPasskey()}
							>
								<Fingerprint className="size-4" />
								{passkeyPending ? "Waiting for your device…" : "Sign in with a passkey"}
							</Button>
						)}
						{ssoProviders.map((provider) => (
							<Button
								key={provider.providerId}
								type="button"
								variant="outline"
								className="w-full"
								disabled={ssoPending !== null}
								onClick={() => void signInWithSso(provider)}
							>
								<KeyRound className="size-4" />
								{ssoPending === provider.providerId
									? "Redirecting…"
									: `Continue with ${provider.name}`}
							</Button>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
