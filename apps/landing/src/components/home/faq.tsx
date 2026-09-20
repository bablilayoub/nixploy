import { Plus } from "lucide-react";

import { Container, SectionTitle } from "@/components/ui";
import { faqs } from "@/lib/landing-data";
import { site } from "@/lib/site";

/*
 * Native `<details>` rather than a client accordion: the answers are in the
 * HTML for search and for a reader with scripts off, the browser handles the
 * keyboard, and the section ships no JavaScript. The plus turns into a cross
 * through `group-open`, so the only state lives in the element itself.
 */
export function Faq() {
	return (
		<section id="faq" className="py-20 lg:py-28">
			<Container>
				<SectionTitle title="Questions people ask first">
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
				</SectionTitle>

				<div className="mx-auto mt-12 max-w-[48rem]">
					{faqs.map((faq) => (
						<details key={faq.q} className="group border-b border-border first:border-t">
							<summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-4 text-body font-medium text-foreground [&::-webkit-details-marker]:hidden">
								{faq.q}
								<Plus
									className="size-4 shrink-0 text-muted-2 transition-transform group-open:rotate-45 motion-reduce:transition-none"
									aria-hidden
								/>
							</summary>
							<p className="pb-5 text-body text-muted">{faq.a}</p>
						</details>
					))}
				</div>
			</Container>
		</section>
	);
}
