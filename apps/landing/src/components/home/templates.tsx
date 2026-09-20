import { Marquee } from "@/components/magicui/marquee";
import { brandIconSrc, Container, Panel, Pill, SectionHead, Tile } from "@/components/ui";
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
		<section id="templates" className="py-20 lg:py-28">
			<Container>
				<SectionHead
					eyebrow="One click"
					title={`${templateCount} stacks you do not have to write`}
					lead="Reviewed compose files: pinned images, named volumes, only the variables the stack actually needs. Give one a domain and TLS, backups and monitoring come with it."
					action={
						<Pill href="/templates" variant="ghost">
							Browse all {templateCount}
						</Pill>
					}
				/>
			</Container>

			{/* The strip runs the full window, not the column: a marquee that stops
			    at the gutter reads as a widget instead of as a catalogue. */}
			<div className="mt-12 flex flex-col gap-4 [mask-image:linear-gradient(to_right,transparent,#000_8%,#000_92%,transparent)] lg:mt-16">
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
		</section>
	);
}
