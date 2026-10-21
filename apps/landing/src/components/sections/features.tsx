import { ArrowUpRight, Boxes, GitBranch, Globe, LineChart, Terminal } from "lucide-react";
import Link from "next/link";

const features = [
	{
		icon: GitBranch,
		title: "A straight path to production.",
		description:
			"Connect your repository, choose a build, and follow every release from commit to running service.",
		href: "/features",
	},
	{
		icon: Boxes,
		title: "A home for the whole stack.",
		description:
			"Applications, Compose stacks, and five database engines. Organize them into projects and environments.",
		href: "/templates",
	},
	{
		icon: Globe,
		title: "The details are handled.",
		description: "Domains, automatic TLS, and routing live alongside the services they belong to.",
		href: "/docs",
	},
	{
		icon: LineChart,
		title: "See what needs you.",
		description:
			"Service health, deployment history, metrics, logs, and backups stay close to the work.",
		href: "/features",
	},
	{
		icon: Terminal,
		title: "Work the way you work.",
		description:
			"Use the panel, CLI, REST API, or MCP. The same permissions follow you across every interface.",
		href: "/agents",
	},
];
export function Features() {
	return (
		<section id="features" className="container-page py-20 lg:py-28">
			<div className="mb-12 grid gap-6 lg:grid-cols-2">
				<p className="max-w-sm text-base leading-relaxed text-muted-foreground">
					The tools to run your stack, from the first deployment to everyday operations.
				</p>
				<h2 className="max-w-xl text-3xl leading-[1.15] font-medium tracking-[-0.035em] sm:text-4xl">
					Less between your code
					<br />
					and the world.
				</h2>
			</div>
			<div className="border-t">
				{features.map(({ icon: Icon, title, description, href }) => (
					<Link
						key={title}
						href={href}
						className="group grid items-start gap-4 border-b py-7 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4 hover:bg-card sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] sm:gap-8 sm:px-4"
					>
						<h3 className="flex items-start gap-4 text-xl leading-snug font-medium tracking-tight">
							<Icon aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
							{title}
						</h3>
						<p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
						<ArrowUpRight
							aria-hidden="true"
							className="hidden size-5 text-muted-foreground group-hover:text-foreground sm:block"
						/>
					</Link>
				))}
			</div>
		</section>
	);
}
