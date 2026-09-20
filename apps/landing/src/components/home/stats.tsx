import type { LucideIcon } from "lucide-react";
import { Bot, Database, LayoutGrid, Server } from "lucide-react";

import { BlurFade } from "@/components/magicui/blur-fade";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { Container, Panel, SectionTitle } from "@/components/ui";
import { stats } from "@/lib/landing-data";

/*
 * Four counted numbers, each in a hairline panel: the label with its icon,
 * the sentence that says where the figure was read, then the figure counting
 * up once it scrolls into view. The data file records how each value was
 * measured; nothing here is typed by hand.
 */

type StatId = (typeof stats)[number]["id"];

const icons: Record<StatId, LucideIcon> = {
	templates: LayoutGrid,
	mcp: Bot,
	databases: Database,
	"control-plane": Server,
};

export function Stats() {
	return (
		<section className="py-20 lg:py-28">
			<Container>
				<SectionTitle title="Numbers that are counted, not claimed">
					Every figure on this page comes from the catalog, the code or the production box.
				</SectionTitle>
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
					{stats.map((stat, index) => {
						const Icon = icons[stat.id];
						const unit = "unit" in stat ? stat.unit : undefined;
						return (
							<BlurFade key={stat.id} inView delay={index * 0.06}>
								<Panel className="h-full">
									<div className="flex items-center justify-between">
										<h3 className="text-body font-semibold text-foreground">{stat.label}</h3>
										<Icon className="size-5 text-muted-2" aria-hidden />
									</div>
									<p className="mt-4 text-small text-muted">{stat.text}</p>
									<p className="mt-8 text-title text-foreground font-display tabular-nums lg:text-headline">
										<NumberTicker value={stat.value} />
										{unit ? <span className="ml-2 text-title text-muted">{unit}</span> : null}
									</p>
								</Panel>
							</BlurFade>
						);
					})}
				</div>
			</Container>
		</section>
	);
}
