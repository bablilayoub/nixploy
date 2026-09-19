import { Marquee } from "@/components/magicui/marquee";
import { brandIconSrc, Container, Panel, Pill, SectionTitle, Tile } from "@/components/ui";
import { featuredTemplateIds } from "@/lib/landing-data";
import { findTemplate, type TemplateEntry, templateCount } from "@/lib/templates";

/*
 * Names, categories and marks come from the generated catalog, never from a
 * list typed by hand — an earlier version of this section advertised Next.js,
 * PostgreSQL and Redis, none of which are templates. An id that stops
 * shipping simply drops out of the strip.
 */
const featured = featuredTemplateIds.map(findTemplate).filter((entry) => entry !== undefined);
const half = Math.ceil(featured.length / 2);
const rows = [featured.slice(0, half), featured.slice(half)];

function TemplateCard({ template }: { template: TemplateEntry }) {
	return (
		<Panel href={`/templates/${template.id}`} className="w-[300px] shrink-0">
			<span className="flex items-center gap-3">
				<Tile size={40}>
					{/* biome-ignore lint/performance/noImgElement: remote brand marks from a CDN, no loader configured */}
					<img
						src={brandIconSrc(template.logo)}
						alt=""
						width={22}
						height={22}
						loading="lazy"
						className="size-[22px]"
					/>
				</Tile>
				<span className="min-w-0">
					<span className="block truncate text-body font-medium text-foreground">
						{template.name}
					</span>
					<span className="mt-0.5 block text-micro text-muted-2">{template.category}</span>
				</span>
			</span>
			<span className="mt-3 line-clamp-2 block text-small text-muted">
				{template.description.replaceAll("`", "")}
			</span>
		</Panel>
	);
}

export function Templates() {
	return (
		<section id="templates" className="py-24 lg:py-32">
			<Container>
				<SectionTitle title={`${templateCount} templates, one click each`}>
					Reviewed compose stacks: pinned images, named volumes, sensible variables. Give one a
					domain and Nixploy handles TLS, backups and monitoring.
				</SectionTitle>

				{/* Two rows in opposite directions at slightly different speeds, so the strip never lines up. */}
				<div className="mt-14 flex flex-col gap-4 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] lg:mt-16">
					{rows.map((row, index) => (
						<Marquee
							key={index === 0 ? "forward" : "reverse"}
							gap="16px"
							repeat={3}
							duration={index === 0 ? "90s" : "110s"}
							reverse={index === 1}
							pauseOnHover
						>
							{row.map((template) => (
								<TemplateCard key={template.id} template={template} />
							))}
						</Marquee>
					))}
				</div>

				<div className="mt-10 flex justify-center">
					<Pill href="/templates" variant="ghost">
						See all {templateCount} templates
					</Pill>
				</div>
			</Container>
		</section>
	);
}
