import { BlurFade } from "@/components/magicui/blur-fade";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { Container } from "@/components/ui";
import { stats } from "@/lib/landing-data";

/*
 * Four counted numbers on one hairline rail, straight under the product
 * window.
 *
 * They used to be four cards with a heading, a paragraph and an icon each —
 * a whole section, a third of a screen, to say four numbers. A rail says the
 * same thing in one band and lets the page get on with it. The data file
 * records how every figure was measured; nothing here is typed by hand.
 */
export function Rail() {
	return (
		<section className="border-y border-border">
			<Container>
				<BlurFade inView>
					<dl className="grid grid-cols-2 gap-y-10 py-12 md:grid-cols-4 md:gap-y-0 md:divide-x md:divide-border">
						{stats.map((stat) => (
							<div key={stat.id} className="md:px-8 md:first:pl-0 md:last:pr-0">
								<dd className="font-display text-title text-foreground tabular-nums lg:text-headline">
									<NumberTicker value={stat.value} />
								</dd>
								<dt className="mt-2 text-small font-medium text-foreground">{stat.label}</dt>
								<p className="mt-1 text-micro text-muted-2">{stat.note}</p>
							</div>
						))}
					</dl>
				</BlurFade>
			</Container>
		</section>
	);
}
