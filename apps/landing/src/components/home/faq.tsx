import { Plus } from "lucide-react";

import { Container, Eyebrow } from "@/components/ui";
import { faqs } from "@/lib/landing-data";
import { site } from "@/lib/site";

/*
 * The questions in two columns: the heading parks on the left while the
 * answers scroll past it, which is what stops a six-row accordion from
 * reading as the page giving up at the bottom.
 *
 * Native `<details>` rather than a client accordion: the answers are in the
 * HTML for search and for a reader with scripts off, the browser handles the
 * keyboard, and the section ships no JavaScript. The plus turns into a cross
 * through `group-open`, so the only state lives in the element itself.
 */
export function Faq() {
	return (
		<section id="faq" className="py-20 lg:py-28">
			<Container>
				<div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
					<div className="lg:col-span-4 lg:sticky lg:top-28 lg:self-start">
						<Eyebrow>Questions</Eyebrow>
						<h2 className="mt-4 text-title text-balance text-foreground sm:text-headline">
							The ones people ask first
						</h2>
						<p className="mt-4 text-body text-muted">
							If yours is not here,{" "}
							<a
								href={`${site.github}/issues`}
								target="_blank"
								rel="noreferrer"
								className="text-accent-strong transition-colors hover:text-foreground"
							>
								open an issue on GitHub
							</a>
							.
						</p>
					</div>

					<div className="lg:col-span-8">
						{faqs.map((faq) => (
							<details key={faq.q} className="group border-b border-border first:border-t">
								<summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-5 text-body font-medium text-foreground transition-colors hover:text-accent-strong [&::-webkit-details-marker]:hidden">
									{faq.q}
									<Plus
										className="size-4 shrink-0 text-muted-2 transition-transform group-open:rotate-45 motion-reduce:transition-none"
										aria-hidden
									/>
								</summary>
								<p className="max-w-[46rem] pb-6 text-body text-muted">{faq.a}</p>
							</details>
						))}
					</div>
				</div>
			</Container>
		</section>
	);
}
