import { GithubIcon } from "@/components/icons";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Button, Section, SectionHeading } from "@/components/ui";
import { site } from "@/lib/site";

/*
 * Facts about the codebase rather than a star count. Both numbers are counted
 * from generated sources, not remembered:
 *   endpoints — entries in `lib/docs/api-catalog.ts`, itself generated from the
 *               live appRouter by scripts/generate-api-catalog.mts
 *   MCP tools — distinct tool names in packages/server/src/modules/mcp/tools.ts
 * Re-count both when the router surface changes; a stale number here is a claim.
 */
const facts = [
	{ label: "Licence", value: "Apache-2.0" },
	{ label: "Repository", value: "nixploy" },
	{ label: "REST endpoints", value: "417" },
	{ label: "MCP tools", value: "36" },
];

export function OpenSource() {
	return (
		<Section id="open-source">
			<div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
				<BlurFade inView>
					<SectionHeading
						eyebrow="Open source"
						title="Built in the open"
						lede="Every line of Nixploy is on GitHub under Apache-2.0 — the deploy engine, the Traefik writer, the migrations, the installer. Read it, fork it, file an issue, send a patch."
					/>
					<div className="mt-8 flex flex-wrap gap-3">
						<Button href={site.github} external>
							<GithubIcon className="size-4" />
							View GitHub
						</Button>
						<Button href={`${site.github}/issues`} variant="secondary" external>
							Open an issue
						</Button>
					</div>
				</BlurFade>

				<BlurFade inView delay={0.1}>
					<dl className="grid grid-cols-2 border-t border-l border-border">
						{facts.map((fact) => (
							<div key={fact.label} className="border-r border-b border-border px-5 py-6">
								<dt className="text-[11px] tracking-[0.14em] text-muted-2 uppercase">
									{fact.label}
								</dt>
								<dd className="mt-2 truncate text-xl font-semibold tracking-tight text-foreground">
									{fact.value}
								</dd>
							</div>
						))}
					</dl>
				</BlurFade>
			</div>
		</Section>
	);
}
