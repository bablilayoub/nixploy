import { ArrowUpRight, Boxes, GitBranch, Globe, LineChart, Terminal } from "lucide-react";
import Link from "next/link";

const features = [
	{
		icon: GitBranch,
		no: "01",
		title: "A straight path to production.",
		description:
			"Connect your repository, choose a build, and follow every release from commit to running service.",
		href: "/features",
	},
	{
		icon: Boxes,
		no: "02",
		title: "A home for the whole stack.",
		description:
			"Applications, Compose stacks, and five database engines. Organize them into projects and environments.",
		href: "/templates",
	},
	{
		icon: Globe,
		no: "03",
		title: "The details are handled.",
		description: "Domains, automatic TLS, and routing live alongside the services they belong to.",
		href: "/docs",
	},
	{
		icon: LineChart,
		no: "04",
		title: "See what needs you.",
		description:
			"Service health, deployment history, metrics, logs, and backups stay close to the work.",
		href: "/features",
	},
	{
		icon: Terminal,
		no: "05",
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
				<p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
					Made for the work
				</p>
				<h2 className="max-w-xl text-4xl leading-[1.1] font-semibold tracking-[-0.045em] sm:text-5xl">
					Less between your code
					<br />
					and the world.
				</h2>
			</div>
			<div className="border-t">
				{features.map(({ icon: Icon, no, title, description, href }) => (
					<Link
						key={no}
						href={href}
						className="group grid items-start gap-4 border-b py-7 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4 hover:bg-card sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1fr)_2rem] sm:gap-8 sm:px-4"
					>
						<span className="font-mono text-xs text-muted-foreground">{no}</span>
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
