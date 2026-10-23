import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/motion-provider";
import { BentoGrid } from "@/components/ui/bento-grid";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { productCaptures } from "@/lib/product-captures";

const capabilities = [
	{
		title: "Applications",
		key: "project",
		href: "/docs/deploy",
		description: "From Git, a Docker image or your own build.",
	},
	{
		title: "Databases",
		key: "workspace",
		href: "/docs/databases",
		description: "Five engines. One familiar workspace.",
	},
	{
		title: "Deployments",
		key: "deployments",
		href: "/docs/deploy",
		description: "Every commit, build and release in context.",
	},
	{
		title: "Monitoring",
		key: "monitoring",
		href: "/docs/observability",
		description: "The health of your services, at a glance.",
	},
	{
		title: "Servers",
		key: "servers",
		href: "/features#infra",
		description: "Your infrastructure, managed together.",
	},
	{
		title: "Templates",
		key: "templates",
		href: "/templates",
		description: "A head start for your next project.",
	},
] as const;

export function Features() {
	return (
		<section id="features" className="reference-section container-page">
			<div className="reference-section-heading">
				<h2>
					One workspace.
					<br />
					For everything you run.
				</h2>
			</div>
			<Reveal>
				<BentoGrid className="reference-capabilities grid-cols-1 auto-rows-auto sm:grid-cols-2 lg:grid-cols-3">
					{capabilities.map((item) => (
						<Link
							key={item.title}
							href={item.href}
							className="group min-w-0 rounded-3xl focus-visible:outline-offset-4"
						>
							<Card className="reference-capability-card">
								<CardHeader className="text-center">
									<CardTitle className="flex items-center justify-center gap-2 text-base font-semibold">
										{item.title}
										<ArrowUpRight
											aria-hidden="true"
											className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
										/>
									</CardTitle>
									<p className="text-sm text-muted-foreground">{item.description}</p>
								</CardHeader>
								<div className="reference-capability-image">
									{(["light", "dark"] as const).map((theme) => (
										<Image
											key={theme}
											src={productCaptures[item.key][theme]}
											alt={`Actual Nixploy ${item.title.toLowerCase()} view, ${theme} theme`}
											width={1440}
											height={1000}
											sizes="(min-width:1024px) 400px, 600px"
											className={`h-full max-w-none object-cover object-left-top ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
										/>
									))}
								</div>
							</Card>
						</Link>
					))}
				</BentoGrid>
			</Reveal>
		</section>
	);
}
