import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Marquee } from "@/components/ui/marquee";
import { productCaptures } from "@/lib/product-captures";

const views = [
	{ key: "project", title: "A place for every project", href: "/docs/getting-started" },
	{ key: "deployments", title: "From commit to deployment", href: "/docs/deploy" },
	{ key: "monitoring", title: "See how everything is running", href: "/docs/observability" },
	{ key: "servers", title: "Your servers, together", href: "/features#infra" },
] as const;
export function WorkflowGallery() {
	return (
		<section className="reference-gallery reference-section">
			<div className="container-page">
				<div className="reference-gallery-intro">
					<h2>
						Less switching tools.
						<br />
						More shipping things.
					</h2>
					<p>
						Your code, your databases, your domains.
						<br className="hidden sm:block" /> Everything in a workspace that feels like yours.
					</p>
					<Link href="/features" className="signal-text-action">
						See how it works <ArrowUpRight aria-hidden="true" className="size-4" />
					</Link>
				</div>
			</div>
			<Marquee
				pauseOnHover
				repeat={2}
				className="reference-gallery-track [--duration:75s] [--gap:16px]"
			>
				{views.map((view) => (
					<Link key={view.key} href={view.href} className="reference-gallery-card">
						<span className="flex items-center justify-between gap-4 px-5 pb-4 text-sm font-semibold">
							{view.title}
							<ArrowUpRight aria-hidden="true" className="size-4" />
						</span>
						<span className="reference-gallery-image">
							{(["light", "dark"] as const).map((theme) => (
								<Image
									key={theme}
									src={productCaptures[view.key][theme]}
									alt={`Actual Nixploy workspace: ${view.title.toLowerCase()}, ${theme} theme`}
									width={1440}
									height={1000}
									sizes="560px"
									className={`h-auto w-full ${theme === "light" ? "dark:hidden" : "hidden dark:block"}`}
								/>
							))}
						</span>
					</Link>
				))}
			</Marquee>
		</section>
	);
}
