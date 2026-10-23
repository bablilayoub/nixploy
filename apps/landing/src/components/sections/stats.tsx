import { TemplateLogo } from "@/components/template-logo";
import { stats } from "@/lib/landing-data";

const integrations = [
	{ name: "GitHub", logo: "github" },
	{ name: "GitLab", logo: "gitlab" },
	{ name: "Docker", logo: "docker" },
	{ name: "PostgreSQL", logo: "postgresql" },
	{ name: "Redis", logo: "redis" },
];
export function Stats() {
	return (
		<section
			aria-label="Supported tools and platform facts"
			className="reference-integrations container-page"
		>
			<p className="text-xs text-muted-foreground">Made for the tools you already use</p>
			<ul className="mt-7 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-12">
				{integrations.map((tool) => (
					<li key={tool.name} className="flex items-center gap-2 text-base font-semibold">
						<TemplateLogo name={tool.name} logo={tool.logo} />
						{tool.name}
					</li>
				))}
			</ul>
			<p className="mt-8 text-xs text-muted-foreground">
				{stats
					.filter((s) => s.id !== "control-plane")
					.map((s) => `${s.value} ${s.label.toLowerCase()}`)
					.join(" · ")}
			</p>
		</section>
	);
}
