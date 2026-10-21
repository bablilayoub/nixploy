import Image from "next/image";
import { productCaptures } from "@/lib/product-captures";

/** Real, current application captures rather than another mock browser frame. */
export function ProductShot() {
	return (
		<section aria-label="Inside the Nixploy workspace" className="container-page pb-16 lg:pb-24">
			<figure>
				<div className="relative overflow-hidden rounded-xl border bg-card shadow-[0_12px_48px_-24px_rgb(20_24_32/20%)]">
					<Image
						src={productCaptures.workspace.light}
						alt="Nixploy project overview with environments, service health and deployment activity"
						width={1440}
						height={1000}
						priority
						sizes="(min-width:1360px) 1280px,100vw"
						className="h-auto w-full dark:hidden"
					/>
					<Image
						src={productCaptures.workspace.dark}
						alt="Nixploy project overview in dark mode"
						width={1440}
						height={1000}
						priority
						sizes="(min-width:1360px) 1280px,100vw"
						className="hidden h-auto w-full dark:block"
					/>
				</div>
				<figcaption className="flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-muted-foreground">
					<span>One workspace for projects, environments and services.</span>
					<span>Example workspace</span>
				</figcaption>
			</figure>
		</section>
	);
}
