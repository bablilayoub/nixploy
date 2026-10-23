import { Check, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageFrame } from "@/components/page-frame";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { faqs, plans } from "@/lib/landing-data";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
	title: "Pricing — Nixploy",
	description: "Self-host Nixploy for free. Forever. Open source.",
};

export default function PricingPage() {
	return (
		<PageFrame
			eyebrow="Pricing"
			title="Free to self-host. No feature gates."
			description="Nixploy is open source. You pay for your server — not for a control plane."
		>
			<div className="grid gap-6 lg:grid-cols-2">
				{plans.map((plan) => (
					<Card
						key={plan.name}
						className={cn("relative", plan.highlight && "border-primary/40 bg-card/80")}
					>
						<CardHeader>
							<div className="flex items-center gap-3">
								<CardTitle className="text-xl">{plan.name}</CardTitle>
								{plan.highlight ? <Badge>Everything included</Badge> : null}
							</div>
							<CardDescription className="text-base">{plan.blurb}</CardDescription>
							<p className="pt-4 font-display text-4xl font-semibold tracking-tight">
								{plan.price}
								{plan.period ? (
									<span className="ml-2 text-base font-normal text-muted-foreground">
										{plan.period}
									</span>
								) : null}
							</p>
						</CardHeader>
						<CardContent>
							<ul className="flex flex-col gap-3">
								{plan.items.map((item) => (
									<li key={item} className="flex gap-3 text-sm text-muted-foreground">
										<Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
										{item}
									</li>
								))}
							</ul>
							<Button
								asChild
								variant={plan.highlight ? "default" : "outline"}
								size="lg"
								className="mt-8 w-full rounded-lg"
							>
								<Link href={plan.cta.href}>{plan.cta.label}</Link>
							</Button>
						</CardContent>
					</Card>
				))}
			</div>

			<div className="mt-16 flex flex-col items-center text-center">
				<p className="max-w-xl text-balance text-muted-foreground">
					Apache-2.0. Install on as many servers as you like. No telemetry you cannot disable.
				</p>
				<Button asChild variant="outline" className="mt-6 rounded-lg">
					<a href={`mailto:${site.email}`}>
						<Mail className="size-4" aria-hidden />
						Email {site.email}
					</a>
				</Button>
			</div>

			<section className="mt-24">
				<h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">
					Questions people ask first
				</h2>
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
			</section>
		</PageFrame>
	);
}
