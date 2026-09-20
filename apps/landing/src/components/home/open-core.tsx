import { Check } from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container, Eyebrow, Pill } from "@/components/ui";
import { openCore } from "@/lib/landing-data";

/*
 * The governance half of the product, on the home page because it is the part
 * people assume is missing from something free.
 *
 * Written as what Nixploy includes, never as what anybody else charges for —
 * the comparison pages are the place for named products, with sources, and a
 * landing page is not. Every line maps to a shipped module; see the data file.
 */
export function OpenCore() {
	return (
		<section id="open" className="py-20 lg:py-28">
			<Container>
				<div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
					<div className="lg:col-span-5">
						<Eyebrow>All of it</Eyebrow>
						<h2 className="mt-4 text-title text-balance text-foreground sm:text-headline">
							There is no enterprise tier
						</h2>
						<p className="mt-5 text-lead text-muted">
							Single sign-on, teams, the audit log and whitelabelling are not a plan you move up to.
							They are in the same Apache-2.0 install as everything else, on the first server you
							put it on.
						</p>
						<div className="mt-8 flex flex-wrap gap-2">
							<Pill href="/pricing" variant="ghost">
								What it costs
							</Pill>
							<Pill href="/docs/teams" variant="outline">
								Roles and teams
							</Pill>
						</div>
					</div>

					{/* One reveal for the whole list: a BlurFade per row would put a
					    div between the <ul> and its <li>s. */}
					<BlurFade inView className="lg:col-span-7">
						<ul>
							{openCore.map((item) => (
								<li
									key={item.title}
									className="flex gap-4 border-t border-border py-5 last:border-b"
								>
									<Check className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden />
									<div className="min-w-0">
										<h3 className="text-body font-medium text-foreground">{item.title}</h3>
										<p className="mt-1 text-small text-muted">{item.text}</p>
									</div>
								</li>
							))}
						</ul>
					</BlurFade>
				</div>
			</Container>
		</section>
	);
}
