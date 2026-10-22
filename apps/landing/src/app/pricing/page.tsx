import { ArrowUpRight, Check, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/motion-provider";
import { PageFrame } from "@/components/page-frame";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { faqs, plans } from "@/lib/landing-data";
import { site } from "@/lib/site";
export const metadata: Metadata = {
	title: "Pricing — Nixploy",
	description: "Self-host Nixploy for free. Forever. Open source.",
};
export default function PricingPage() {
	const [platform, support] = plans;
	return (
		<PageFrame
			eyebrow="Pricing"
			title="Your server bill. That's it."
			description="The whole platform is free to self-host. Your infrastructure is the only required cost."
		>
			<div className="signal-price-layout">
				<Reveal className="signal-free-plan">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="text-xl font-medium">{platform.name}</h2>
						<span className="rounded-full border border-primary/30 px-3 py-1 text-xs text-primary">
							Everything included
						</span>
					</div>
					<div className="signal-price">
						$0
						<span className="text-base font-normal tracking-normal text-muted-foreground">
							forever
						</span>
					</div>
					<p className="max-w-lg text-muted-foreground">{platform.blurb}</p>
					<Button asChild size="lg" className="mt-7 w-full">
						<Link href={platform.cta.href}>
							{platform.cta.label}
							<ArrowUpRight className="size-4" aria-hidden="true" />
						</Link>
					</Button>
					<ul className="mt-8 grid gap-4 border-t pt-7 sm:grid-cols-2">
						{platform.items.map((item) => (
							<li key={item} className="flex items-start gap-3 text-sm">
								<Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
								{item}
							</li>
						))}
					</ul>
				</Reveal>
				<div className="rounded-xl border bg-card p-7 sm:p-9">
					<p className="signal-kicker">When you need a hand</p>
					<h2 className="mt-5 text-3xl font-medium tracking-tight">{support.name}</h2>
					<p className="mt-4 leading-relaxed text-muted-foreground">{support.blurb}</p>
					<ul className="mt-7 space-y-4 border-t pt-6">
						{support.items.map((item) => (
							<li key={item} className="text-sm text-muted-foreground">
								{item}
							</li>
						))}
					</ul>
					<Button asChild variant="outline" className="mt-8 w-full">
						<a href={support.cta.href}>
							<Mail className="size-4" aria-hidden="true" />
							Talk to us
						</a>
					</Button>
					<p className="mt-4 text-xs text-muted-foreground">
						Optional help. The same open-source software.
					</p>
				</div>
			</div>
			<div className="signal-facts mt-10">
				{[
					{ title: "No per-seat pricing", text: "Invite your team without a software seat bill." },
					{ title: "No license key", text: "Apache-2.0. Run it on as many servers as you need." },
					{ title: "No feature gates", text: "SSO, teams, audit logs and backups are included." },
				].map((item) => (
					<div key={item.title}>
						<h2 className="text-sm font-medium">{item.title}</h2>
						<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.text}</p>
					</div>
				))}
			</div>
			<section className="mx-auto mt-24 max-w-3xl">
				<h2 className="text-3xl font-medium tracking-tight">Before you install.</h2>
				<Accordion type="single" collapsible className="mt-8 w-full">
					{faqs.map((faq) => (
						<AccordionItem key={faq.q} value={faq.q}>
							<AccordionTrigger className="text-base">{faq.q}</AccordionTrigger>
							<AccordionContent className="text-base text-muted-foreground">
								{faq.a}
							</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
				<p className="mt-8 text-sm text-muted-foreground">
					Still have a question?{" "}
					<a className="text-primary underline underline-offset-4" href={`mailto:${site.email}`}>
						{site.email}
					</a>
				</p>
			</section>
		</PageFrame>
	);
}
