import { BlurFade } from "@/components/magicui/blur-fade";
import { Button, Section, SectionHeading } from "@/components/ui";
import { featuredTemplateIds } from "@/lib/landing-data";
import { findTemplate, templateCount } from "@/lib/templates";

/*
 * Names and logos come from the generated catalog, never from a list typed by
 * hand — an earlier version of this section advertised Next.js, PostgreSQL,
 * Redis and MongoDB, none of which are templates (the first is a framework you
 * deploy from Git, the rest are managed database engines).
 */
const featured = featuredTemplateIds.map(findTemplate).filter((entry) => entry !== undefined);

export function Templates() {
	return (
		<Section id="templates">
			<BlurFade inView>
				<SectionHeading
					eyebrow="Templates"
					title={`${templateCount} ready-to-deploy applications`}
					lede="Pick one and it deploys. What lands is a plain compose stack you can edit, back up and move — not a black box."
				/>
			</BlurFade>

			<BlurFade inView delay={0.08}>
				<ul className="mt-14 grid grid-cols-2 border-t border-l border-border sm:grid-cols-3 lg:grid-cols-6">
					{featured.map((entry) => (
						<li
							key={entry.id}
							className="flex items-center gap-2.5 border-r border-b border-border px-4 py-5 text-[13px] text-muted"
						>
							{/* biome-ignore lint/performance/noImgElement: remote brand icons, one flat grey */}
							<img
								src={`https://cdn.simpleicons.org/${entry.logo}/8a8a93`}
								alt=""
								width={18}
								height={18}
								loading="lazy"
								className="size-[18px] shrink-0"
							/>
							<span className="truncate">{entry.name}</span>
						</li>
					))}
				</ul>
			</BlurFade>

			<BlurFade inView delay={0.14}>
				<div className="mt-10">
					<Button href="/templates" variant="secondary" arrow>
						Browse the catalog
					</Button>
				</div>
			</BlurFade>
		</Section>
	);
}
