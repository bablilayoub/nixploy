import { LayoutPanelLeft, LockKeyhole } from "lucide-react";
import Image from "next/image";
import { productCaptures } from "@/lib/product-captures";

/** Actual product captures, with identical geometry in the light and dark theme. */
export function ProductShot() {
	return (
		<section aria-label="Inside the Nixploy workspace" className="container-page pb-16 lg:pb-24">
			<figure className="overflow-hidden rounded-xl border bg-card shadow-[var(--overlay-shadow)]">
				<div className="flex h-10 items-center justify-between gap-3 border-b bg-card px-4">
					<LayoutPanelLeft aria-hidden="true" className="size-3.5 text-muted-foreground" />
					<span className="inline-flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
						<LockKeyhole className="size-3" />
						Your workspace / Nixploy
					</span>
					<span className="w-8" />
				</div>
				<div className="relative aspect-[1440/1000] bg-background">
					<Image
						src={productCaptures.workspace.light}
						alt="Nixploy workspace with projects, service health, and a continuous deployment timeline"
						width={1440}
						height={1000}
						priority
						sizes="(min-width: 1360px) 1280px, 100vw"
						className="h-auto w-full dark:hidden"
					/>
					<Image
						src={productCaptures.workspace.dark}
						alt="Nixploy workspace in dark mode"
						width={1440}
						height={1000}
						priority
						sizes="(min-width: 1360px) 1280px, 100vw"
						className="hidden h-auto w-full dark:block"
					/>
				</div>
				<figcaption className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 font-mono text-[10px] text-muted-foreground">
					<span>An example workspace.</span>
					<span>Projects · Deployments · Infrastructure</span>
				</figcaption>
			</figure>
		</section>
	);
}
