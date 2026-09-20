import { Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { openCore } from "@/lib/landing-data";

/*
 * The governance half of the product, as a list rather than a grid of cards.
 *
 * Six equal cards, each an icon in a rounded square over two lines of grey,
 * is the shape every generated page uses for "features" — it makes six
 * different claims look like one texture. A ruled list reads as an inventory,
 * which is what this section is: the things people assume are paywalled,
 * named, in the same install as everything else.
 *
 * Stated as what Nixploy includes, never as what anybody else charges for;
 * the comparison pages are the place for named products, with sources.
 */
export function Platform() {
	return (
		<section id="open" className="py-20 lg:py-28">
			<div className="container-page grid gap-12 lg:grid-cols-12 lg:gap-16">
				<div className="lg:col-span-5">
					<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
						All of it
					</p>
					<h2 className="mt-4 text-4xl font-semibold tracking-tight text-balance lg:text-5xl">
						There is no enterprise tier
					</h2>
					<p className="mt-5 text-lg text-muted-foreground">
						Single sign-on, teams, the audit log and whitelabelling are not a plan you move up to.
						They are in the same Apache-2.0 install as everything else, on the first server you put
						it on.
					</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<Button asChild variant="outline" size="lg" className="rounded-xl">
							<Link href="/pricing">What it costs</Link>
						</Button>
						<Button asChild variant="ghost" size="lg" className="rounded-xl">
							<Link href="/docs/teams">Roles and teams</Link>
						</Button>
					</div>
				</div>

				<dl className="lg:col-span-7">
					{openCore.map((item) => (
						<div
							key={item.title}
							className="grid gap-x-6 gap-y-1 border-t py-5 last:border-b sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
						>
							<dt className="flex items-start gap-2.5 font-medium">
								<Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
								{item.title}
							</dt>
							<dd className="text-muted-foreground sm:pt-0.5">{item.text}</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}
