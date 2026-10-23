"use client";

import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TwoFactorCard } from "@/components/settings/profile/two-factor-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { authClient, useSession } from "@/lib/auth-client";

/**
 * Interstitial shown in place of the dashboard when the active organization
 * requires 2FA and the member has not enabled it yet. The setup card works
 * through better-auth routes (not the gated tRPC API), and once the session
 * reports twoFactorEnabled the page refreshes into the real dashboard.
 */
export function TwoFactorRequiredGate({ orgName }: { orgName?: string }) {
	const router = useRouter();
	const { data: session } = useSession();
	const enabled = Boolean(
		(session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled,
	);

	useEffect(() => {
		if (enabled) router.refresh();
	}, [enabled, router]);

	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-5">
			<Card className="min-w-0">
				<CardContent className="flex w-full max-w-md flex-col items-start gap-4 text-start">
					<ShieldAlert className="size-10 text-muted-foreground" />
					<h1 className="text-xl font-semibold">Two-factor authentication required</h1>
					<p className="text-sm text-muted-foreground">
						{orgName ? (
							<>
								<span className="font-medium text-foreground">{orgName}</span> requires two-factor
								authentication.{" "}
							</>
						) : (
							"Your organization requires two-factor authentication. "
						)}
						Set it up below to continue — everything else stays locked until you do.
					</p>
				</CardContent>
			</Card>
			<div className="w-full max-w-2xl">
				<TwoFactorCard />
			</div>
			<Button
				variant="ghost"
				size="sm"
				onClick={async () => {
					await authClient.signOut();
					router.push("/login");
				}}
			>
				Sign out instead
			</Button>
		</div>
	);
}
