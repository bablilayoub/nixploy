import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { heroBadge, heroLead, heroTitle } from "@/lib/landing-data";

/** The product gets the canvas; language explains the self-hosting choice. */
export function Hero() {
	return (
		<section className="container-page pt-32 pb-12 lg:pt-40 lg:pb-14">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.8fr)] lg:items-end lg:gap-20">
				<div>
					<a
						href={heroBadge.href}
						target="_blank"
						rel="noreferrer"
						className="mb-7 inline-flex min-h-9 items-center gap-2 rounded-full border bg-card px-3 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
					>
						{heroBadge.version}
						<ArrowUpRight aria-hidden="true" className="size-3" />
					</a>
					<h1 className="max-w-3xl text-[clamp(2.75rem,5vw,4.5rem)] leading-[1.05] font-medium tracking-[-0.05em]">
						{heroTitle[0]}
						<br />
						{heroTitle[1]}
					</h1>
				</div>
				<div className="max-w-sm space-y-7 lg:pb-1">
					<p className="text-lg leading-relaxed text-muted-foreground">{heroLead}</p>
					<div className="flex flex-wrap items-center gap-3">
						<Button asChild size="lg" className="h-12 rounded-md px-6">
							<Link href="/docs/install">Install Nixploy</Link>
						</Button>
						<Link
							href="/docs"
							className="inline-flex min-h-12 items-center px-3 text-sm font-medium underline-offset-4 hover:underline"
						>
							Read the documentation
						</Link>
					</div>
				</div>
			</div>
		</section>
	);
}
