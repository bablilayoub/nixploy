import { ShieldCheck } from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { Container } from "@/components/ui";
import { security, securityBadges } from "@/lib/landing-data";

export function Security() {
	return (
		<section id="security" className="py-16 sm:py-24">
			<Container>
				<div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
					<BlurFade inView>
						<h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
							Secure by default
						</h2>
						<p className="mt-4 max-w-md text-sm leading-relaxed text-muted sm:text-base">
							Nixploy is multi-tenant from the first commit: organizations, capabilities and
							encryption are enforced in the server, not the UI.
						</p>
						<div className="mt-8 flex gap-3">
							{securityBadges.map((badge) => (
								<span
									key={badge}
									className="grid size-20 place-content-center gap-1 rounded-full border border-border-strong bg-surface-2 text-center font-mono text-[10px] leading-none text-muted"
								>
									<ShieldCheck className="mx-auto size-4 text-foreground" />
									{badge}
								</span>
							))}
						</div>
					</BlurFade>
					<BlurFade inView delay={0.1}>
						<dl className="divide-y divide-border border-y border-border">
							{security.map((item) => (
								<div key={item.title} className="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
									<dt className="font-display text-base font-semibold text-foreground">
										{item.title}
									</dt>
									<dd className="text-sm leading-relaxed text-muted">{item.body}</dd>
								</div>
							))}
						</dl>
					</BlurFade>
				</div>
			</Container>
		</section>
	);
}
