"use client";

import { KeyRound, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { describeError } from "@/lib/describe-error";

/**
 * Shown in place of the dashboard when the active organization requires SSO
 * and this session did not come from the identity provider.
 *
 * Unlike the 2FA gate there is nothing to set up here: the only way through is
 * to sign in again through the IdP, so the page offers exactly that. It is
 * deliberately not automatic — a silent redirect to an IdP that is down or
 * misconfigured is an infinite loop with no way to read the error.
 */
export function SsoRequiredGate({
	orgName,
	providers,
}: {
	orgName?: string;
	providers: Array<{ providerId: string; name: string }>;
}) {
	const router = useRouter();
	const [pending, setPending] = useState<string | null>(null);

	async function signInWith(provider: { providerId: string; name: string }) {
		setPending(provider.providerId);
		try {
			// Sign the password session out first: staying signed in would put the
			// user straight back on this page after the IdP round trip, since the
			// existing session is the thing being refused.
			await authClient.signOut().catch(() => {});
			const res = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: window.location.origin },
				body: JSON.stringify({
					provider: provider.providerId,
					callbackURL: "/dashboard",
					errorCallbackURL: "/login",
				}),
			});
			const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
			if (!res.ok || !data.url) {
				toast.error(data.message ?? `Could not start ${provider.name} sign-in`);
				return;
			}
			window.location.href = data.url;
		} catch (error) {
			toast.error(describeError(error, "Network error"));
		} finally {
			setPending(null);
		}
	}

	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6">
			<div className="flex max-w-md flex-col items-center gap-2 text-center">
				<KeyRound className="size-10 text-muted-foreground" />
				<h1 className="text-xl font-semibold">Single sign-on required</h1>
				<p className="text-sm text-muted-foreground">
					{orgName ? (
						<>
							<span className="font-medium text-foreground">{orgName}</span> requires single
							sign-on.{" "}
						</>
					) : (
						"Your organization requires single sign-on. "
					)}
					Sign in through your identity provider to continue.
				</p>
			</div>

			<div className="flex w-full max-w-sm flex-col gap-2">
				{providers.length === 0 ? (
					<p className="text-center text-sm text-muted-foreground">
						No identity provider is configured on this instance. Ask an instance admin to add one,
						or to turn the requirement off.
					</p>
				) : (
					providers.map((provider) => (
						<Button
							key={provider.providerId}
							disabled={pending !== null}
							onClick={() => void signInWith(provider)}
						>
							<KeyRound className="size-4" />
							{pending === provider.providerId ? "Redirecting…" : `Continue with ${provider.name}`}
						</Button>
					))
				)}
				<Button
					variant="ghost"
					disabled={pending !== null}
					onClick={() => {
						void authClient.signOut().then(() => router.push("/login"));
					}}
				>
					<LogOut className="size-4" />
					Sign out
				</Button>
			</div>
		</div>
	);
}
