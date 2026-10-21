"use client";

import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { Tabs } from "radix-ui";
import { productCaptures } from "@/lib/product-captures";

const views = [
	{
		key: "workspace",
		label: "Projects",
		description: "Projects, environments and service health in one place.",
		alt: "Project overview with environments, service health and recent deployment activity",
	},
	{
		key: "deployments",
		label: "Deployments",
		description: "Follow a release from its commit through build logs and deployment history.",
		alt: "Deployment history with commit details, release status and log actions",
	},
	{
		key: "monitoring",
		label: "Monitoring",
		description: "Find a service, inspect its health and open the tools you need.",
		alt: "Fleet monitoring with searchable services and a selected service detail",
	},
] as const;

/** Browse real example captures, with tab keyboard behavior and no live-data claims. */
export function ProductShot() {
	return (
		<section
			id="workspace"
			aria-label="Explore the Nixploy workspace"
			className="container-page scroll-mt-24 pb-16 lg:pb-24"
		>
			<Tabs.Root
				defaultValue="workspace"
				className="overflow-hidden rounded-xl border bg-card shadow-[var(--surface-shadow)]"
			>
				<div className="flex flex-wrap items-center justify-between gap-x-5 border-b px-3 sm:px-5">
					<Tabs.List
						aria-label="Workspace preview"
						className="flex min-w-0 flex-wrap gap-x-2 sm:gap-x-5"
					>
						{views.map((view) => (
							<Tabs.Trigger
								key={view.key}
								value={view.key}
								className="min-h-12 border-b-2 border-transparent px-2 text-sm focus-visible:-outline-offset-4 text-muted-foreground hover:text-foreground data-[state=active]:border-foreground data-[state=active]:font-medium data-[state=active]:text-foreground"
							>
								{view.label}
							</Tabs.Trigger>
						))}
					</Tabs.List>
					<p className="py-3 text-xs text-muted-foreground">Example workspace</p>
				</div>
				{views.map((view) => (
					<Tabs.Content
						key={view.key}
						value={view.key}
						className="m-0 focus-visible:-outline-offset-2"
					>
						<figure>
							<section
								aria-label={`${view.label} screenshot, horizontally scrollable on small screens`}
								// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll the screenshot viewport
								tabIndex={0}
								className="max-h-[600px] overflow-auto bg-background sm:max-h-[720px]"
							>
								{(["light", "dark"] as const).map((theme) => (
									<Image
										key={theme}
										src={productCaptures[view.key][theme]}
										alt={`${view.alt}, ${theme} theme`}
										width={1440}
										height={1000}
										priority={view.key === "workspace"}
										sizes="(min-width:1360px) 1280px, (min-width:768px) 100vw, 760px"
										className={`h-auto w-full min-w-[760px] ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
									/>
								))}
							</section>
							<figcaption className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t px-5 py-4 text-sm">
								<p className="max-w-xl text-muted-foreground">{view.description}</p>
								{(["light", "dark"] as const).map((theme) => (
									<a
										key={theme}
										href={productCaptures[view.key][theme]}
										target="_blank"
										rel="noreferrer"
										className={`min-h-11 items-center gap-2 underline-offset-4 hover:underline ${theme === "light" ? "inline-flex dark:hidden" : "hidden dark:inline-flex"}`}
									>
										View full size<span className="sr-only"> ({view.label}, opens a new tab)</span>
										<ArrowUpRight aria-hidden="true" className="size-4" />
									</a>
								))}
							</figcaption>
						</figure>
					</Tabs.Content>
				))}
			</Tabs.Root>
		</section>
	);
}
