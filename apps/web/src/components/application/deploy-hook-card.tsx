"use client";

import { Webhook } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { CopyButton } from "@/components/services/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic deploy hook: `POST /api/webhooks/deploy/<appName>` authenticated
 * with an API key (`x-api-key` header or `Authorization: Bearer`). The key
 * owner must be a member of the application's organization with
 * `service.deploy`; unknown apps and missing capability both answer 404.
 * Contract: `apps/web/src/app/api/webhooks/deploy/[appName]/route.ts`.
 *
 * Mount on the application Deploy tab (`deployments-tab.tsx`) as
 * `<DeployHookCard appName={application.appName} />`.
 */
export function DeployHookCard({ appName }: { appName: string }) {
	// The URL needs `window.location.origin`; render the skeleton until mounted
	// so the server and client paints agree.
	const [origin, setOrigin] = useState<string | null>(null);
	useEffect(() => setOrigin(window.location.origin), []);

	const url = origin ? `${origin}/api/webhooks/deploy/${appName}` : null;
	const curl = url ? `curl -X POST -H "x-api-key: $NIXPLOY_API_KEY" ${url}` : "";

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<Webhook className="size-4 text-muted-foreground" />
					Deploy hook
				</span>
			}
			description={
				<>
					Trigger a redeploy from any CI system that can send a POST with a header. Authenticate
					with an API key (
					<Link href="/dashboard/settings/profile" className="underline underline-offset-2">
						Settings → Profile → API keys
					</Link>
					) whose owner has the "Deploy & redeploy" permission in this organization.
				</>
			}
		>
			{!url ? (
				<Skeleton className="h-20 w-full" />
			) : (
				<div className="grid gap-4">
					<div className="grid gap-1.5">
						<Label htmlFor="deploy-hook-url">Webhook URL</Label>
						<div className="flex items-center gap-2">
							<Input id="deploy-hook-url" readOnly value={url} className="font-mono text-xs" />
							<CopyButton value={url} label="Copy webhook URL" />
						</div>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="deploy-hook-curl">Example</Label>
						<div className="flex items-start gap-2">
							<pre
								id="deploy-hook-curl"
								className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs"
							>
								{curl}
							</pre>
							<CopyButton value={curl} label="Copy curl command" />
						</div>
						<p className="text-xs text-muted-foreground">
							Method <code className="font-mono">POST</code>, header{" "}
							<code className="font-mono">x-api-key: nxp_…</code> (or{" "}
							<code className="font-mono">Authorization: Bearer nxp_…</code>), no body. Responds
							with the queued <code className="font-mono">deploymentId</code>; limited to 30
							requests per minute per key.
						</p>
					</div>
				</div>
			)}
		</SettingsSection>
	);
}
