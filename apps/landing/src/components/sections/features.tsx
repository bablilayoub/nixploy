import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/motion-provider";
import { productCaptures } from "@/lib/product-captures";

const workflows = [
	{
		title: "Give every environment a home",
		description:
			"Group applications, Compose stacks and databases by project. Keep production and staging easy to tell apart.",
		href: "/docs/getting-started",
		label: "Projects and environments",
	},
	{
		title: "Follow every release",
		description:
			"Choose your source and builder, inspect build logs, and return to an earlier release when you need to.",
		href: "/docs/deploy",
		label: "Deployment workflow",
	},
	{
		title: "Keep operations close",
		description:
			"Domains, environment variables, runtime logs and backups belong to the service. Find them in the same tab order across every service kind.",
		href: "/features",
		label: "Explore the platform",
	},
];

export function Features() {
	return (
		<section id="features" className="container-page py-20 lg:py-28">
			<div className="mb-10 flex flex-wrap items-end justify-between gap-6">
				<h2 className="max-w-xl text-3xl leading-[1.15] font-medium tracking-[-0.035em] sm:text-4xl">
					A place for every environment.
				</h2>
				<p className="max-w-sm text-base leading-relaxed text-muted-foreground">
					From the first service to the next release, the workspace follows the way your stack is
					organized.
				</p>
			</div>
			<div className="signal-feature-panel">
				<Reveal className="border-t">
					{workflows.map((item) => (
						<div key={item.title} className="border-b py-7 first:pt-6">
							<h3 className="text-lg font-medium tracking-tight">{item.title}</h3>
							<p className="mt-3 text-sm leading-relaxed text-muted-foreground">
								{item.description}
							</p>
							<Link
								href={item.href}
								className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
							>
								{item.label}
								<ArrowUpRight aria-hidden="true" className="size-4" />
							</Link>
						</div>
					))}
				</Reveal>
				<figure className="min-w-0 rounded-xl border bg-card p-3 sm:p-5">
					{(["light", "dark"] as const).map((theme) => (
						<Image
							key={theme}
							src={productCaptures.project[theme]}
							alt={`A project with services grouped into environments, ${theme} theme`}
							width={1440}
							height={1000}
							sizes="(min-width:1024px) 55vw, 100vw"
							className={`h-auto w-full rounded-md border ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
						/>
					))}
					<figcaption className="pt-4 text-xs leading-relaxed text-muted-foreground">
						A real project view from an example workspace. The same service structure continues into
						deployments, runtime and configuration.
					</figcaption>
				</figure>
			</div>
		</section>
	);
}
