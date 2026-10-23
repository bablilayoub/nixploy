"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/services/copy-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Where to point a Prometheus at this organization.
 *
 * The key never appears here: the example uses `$NIXPLOY_API_KEY`, so the
 * card can be screenshotted and pasted into a ticket. Scraping is scoped to
 * the key's organization, which is why the scrape config is per org rather
 * than instance-wide.
 */
export function PrometheusCard() {
	// `window.location.origin` is client-only; keep SSR and the first paint
	// in agreement by rendering a skeleton until mounted.
	const [origin, setOrigin] = useState<string | null>(null);
	useEffect(() => setOrigin(window.location.origin), []);

	if (!origin) return <Skeleton className="h-32 w-full rounded-xl" />;

	const url = `${origin}/api/metrics`;
	const curl = `curl -H "x-api-key: $NIXPLOY_API_KEY" ${url}`;

	return (
		<section className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3">
			<div className="flex items-center gap-2">
				<Activity className="size-4 shrink-0 text-muted-foreground" />
				<h2 className="text-sm font-medium">Prometheus endpoint</h2>
			</div>
			<p className="text-xs text-muted-foreground">
				Service CPU and memory, deployment counts, uptime probes and the deploy queue in OpenMetrics
				format, scoped to this organization. Authenticate with an API key (
				<Link href="/dashboard/settings/profile" className="underline underline-offset-2">
					Settings → Profile → API keys
				</Link>
				) — a read-only key is enough.
			</p>
			<div className="grid gap-1.5">
				<Label htmlFor="prometheus-url">Scrape URL</Label>
				<div className="flex items-center gap-2">
					<Input id="prometheus-url" readOnly value={url} className="font-mono text-xs" />
					<CopyButton value={url} label="Copy scrape URL" />
				</div>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="prometheus-curl">Try it</Label>
				<div className="flex items-center gap-2">
					<Input id="prometheus-curl" readOnly value={curl} className="font-mono text-xs" />
					<CopyButton value={curl} label="Copy curl command" />
				</div>
			</div>
		</section>
	);
}
