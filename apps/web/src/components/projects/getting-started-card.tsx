"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Circle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "nixploy:getting-started-dismissed";

interface Step {
	key: string;
	label: string;
	hint: string;
	done: boolean;
	href: string;
	cta: string;
}

/**
 * The path from a fresh install to a service on a real domain, as five live
 * checks (UX audit F5). Before this card the steps were spread over four pages
 * with nothing linking them, so a new operator had to guess the order.
 *
 * Disappears for good once every step is done, and can be dismissed earlier —
 * the dismissal is per browser, which is the right scope for a hint.
 */
export function GettingStartedCard({ firstProjectId }: { firstProjectId?: string | null }) {
	const trpc = useTRPC();
	const { isInstanceAdmin } = useCapabilities();
	const [dismissed, setDismissed] = useState(true);
	const { data } = useQuery(trpc.project.onboarding.queryOptions());

	// Read after mount: localStorage is not available while rendering on the
	// server, and a card that flashes in on hydration is worse than one that
	// appears a tick late.
	useEffect(() => {
		try {
			setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
		} catch {
			setDismissed(false);
		}
	}, []);

	if (!data || dismissed) return null;

	const servicesHref = firstProjectId ? `/dashboard/projects/${firstProjectId}` : "/dashboard";
	const steps: Step[] = [
		...(isInstanceAdmin
			? [
					{
						key: "panel-domain",
						label: "Serve the panel on your own domain",
						hint: "Adds HTTPS and stops the browser warning on the bare IP.",
						done: data.panelDomain,
						href: "/dashboard/settings/server",
						cta: "Set domain",
					},
				]
			: []),
		{
			key: "git-provider",
			label: "Connect a Git provider",
			hint: "Deploy straight from a repository, with push-to-deploy webhooks.",
			done: data.gitProvider,
			href: "/dashboard/settings/git-providers",
			cta: "Connect",
		},
		{
			key: "service",
			label: "Add your first service",
			hint: "An app from Git or an image, a database, or a one-click template.",
			done: data.service,
			href: "/dashboard/templates",
			cta: "Browse templates",
		},
		{
			key: "deployment",
			label: "Ship a deployment",
			hint: "Build and roll it out; the logs stream while it runs.",
			done: data.deployment,
			href: servicesHref,
			cta: "Open services",
		},
		{
			key: "domain",
			label: "Attach a domain",
			hint: "Point DNS at this server, then Nixploy issues the certificate.",
			done: data.domain,
			href: servicesHref,
			cta: "Add domain",
		},
	];

	const doneCount = steps.filter((step) => step.done).length;
	if (doneCount === steps.length) return null;

	const dismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(DISMISS_KEY, "1");
		} catch {
			// A browser that refuses storage just shows the card again later.
		}
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
				<div className="space-y-1.5">
					<CardTitle>Finish setting up</CardTitle>
					<CardDescription>
						{doneCount} of {steps.length} done — the rest of the way to a service on your own
						domain.
					</CardDescription>
				</div>
				<Button variant="ghost" size="icon" aria-label="Dismiss checklist" onClick={dismiss}>
					<X className="size-4" />
				</Button>
			</CardHeader>
			<CardContent className="pt-0">
				<ol className="divide-y">
					{steps.map((step) => (
						<li key={step.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
							{step.done ? (
								<Check className="size-4 shrink-0 text-success" aria-label="Done" />
							) : (
								<Circle className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
							)}
							<div className="flex min-w-0 flex-1 flex-col">
								<span
									className={cn(
										"truncate text-sm",
										step.done ? "text-muted-foreground line-through" : "font-medium",
									)}
								>
									{step.label}
								</span>
								{!step.done && (
									<span className="truncate text-xs text-muted-foreground">{step.hint}</span>
								)}
							</div>
							{!step.done && (
								<Button asChild variant="outline" size="sm" className="shrink-0">
									<Link href={step.href}>{step.cta}</Link>
								</Button>
							)}
						</li>
					))}
				</ol>
			</CardContent>
		</Card>
	);
}
