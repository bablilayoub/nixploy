import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { faqs } from "@/lib/landing-data";
import { site } from "@/lib/site";

/* The questions, in the shadcn accordion. */
export function Faq() {
	return (
		<section id="faq" className="px-6 py-20 lg:py-28">
			<div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-12 lg:gap-16">
				<div className="lg:col-span-4">
					<p className="font-mono text-xs tracking-[0.18em] text-muted-foreground uppercase">
						Questions
					</p>
					<h2 className="mt-4 text-4xl font-semibold tracking-tight text-balance lg:text-5xl">
						The ones people ask first
					</h2>
					<p className="mt-4 text-muted-foreground">
						If yours is not here,{" "}
						<a
							href={`${site.github}/issues`}
							target="_blank"
							rel="noreferrer"
							className="text-primary underline-offset-4 hover:underline"
						>
							open an issue on GitHub
						</a>
						.
					</p>
				</div>

				<Accordion type="single" collapsible className="w-full lg:col-span-8">
					{faqs.map((faq) => (
						<AccordionItem key={faq.q} value={faq.q}>
							<AccordionTrigger className="text-base">{faq.q}</AccordionTrigger>
							<AccordionContent className="text-base text-muted-foreground">
								{faq.a}
							</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
			</div>
		</section>
	);
}
