import Link from "next/link";
import { Button } from "@/components/ui/button";
import { heroLead, heroTitle } from "@/lib/landing-data";

/** The product gets the canvas; language explains the self-hosting choice. */
export function Hero() {
	return (
		<section className="container-page pt-36 pb-10 lg:pt-40 lg:pb-12">
			<div className="max-w-4xl">
				<h1 className="max-w-3xl text-[clamp(2.75rem,5vw,4.5rem)] leading-[1.05] font-medium tracking-[-0.05em]">
					{heroTitle[0]}
					<br />
					{heroTitle[1]}
				</h1>
				<p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">{heroLead}</p>
				<div className="mt-7 flex flex-wrap items-center gap-3">
					<Button asChild size="lg" className="h-12 rounded-md px-6">
						<Link href="/docs/install">Install Nixploy</Link>
					</Button>
					<Link
						href="#workspace"
						className="inline-flex min-h-12 items-center px-3 text-sm font-medium underline-offset-4 hover:underline"
					>
						Explore the workspace
					</Link>
				</div>
			</div>
		</section>
	);
}
