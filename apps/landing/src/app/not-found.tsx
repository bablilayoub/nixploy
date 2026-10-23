import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
	title: "Page not found — Nixploy",
	robots: { index: false, follow: true },
};

/*
 * The 404. It has the site's own frame rather than Next's default, so the bar
 * and the footer are still there and the reader has somewhere to go — and so
 * the page has a `#main-content` landmark like every other one.
 */
const destinations = [
	{
		href: "/docs",
		label: "Documentation",
		text: "Install, deploy, domains, backups, the CLI and MCP.",
	},
	{
		href: "/templates",
		label: "Templates",
		text: "Reviewed compose stacks you can deploy in one click.",
	},
	{ href: "/features", label: "Features", text: "Everything the platform does, in one page." },
	{ href: "/pricing", label: "Pricing", text: "Free to self-host, with nothing behind a plan." },
] as const;

export default function NotFound() {
	return (
		<PageFrame
			eyebrow="404"
			title="That page is not here"
			description="The link may be out of date, or the page may have moved. These are the ones people usually want."
			actions={
				<Button asChild size="lg" className="rounded-lg">
					<Link href="/">
						Back to the home page
						<ArrowRight className="size-4" />
					</Link>
				</Button>
			}
		>
			<ul className="grid gap-4 sm:grid-cols-2">
				{destinations.map((item) => (
					<li key={item.href}>
						<Link href={item.href} className="block h-full">
							<Card className="h-full gap-0 p-6 transition-colors hover:border-foreground/25">
								<h2 className="font-medium">{item.label}</h2>
								<p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
							</Card>
						</Link>
					</li>
				))}
			</ul>
		</PageFrame>
	);
}
