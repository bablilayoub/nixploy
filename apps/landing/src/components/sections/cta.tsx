import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DotPattern } from "@/components/ui/dot-pattern";
import { ShimmerButton } from "@/components/ui/shimmer-button";

/* The close: @magicui/dot-pattern behind @magicui/shimmer-button. */
export function Cta() {
	return (
		<section className="py-20 lg:py-28">
			<div className="container-page">
				<div className="relative overflow-hidden rounded-3xl border bg-card/40 px-6 py-20 text-center">
					<DotPattern
						width={24}
						height={24}
						className="opacity-60 [mask-image:radial-gradient(420px_circle_at_center,white,transparent)]"
					/>
					<div className="relative">
						<h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-balance lg:text-6xl">
							Rent the box. Keep the rest.
						</h2>
						<p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
							One command, three services, and the first account is yours.
						</p>
						<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
							<ShimmerButton className="shadow-2xl" background="oklch(0.22 0 0)">
								<Link
									href="/docs/install"
									className="flex items-center gap-2 text-base font-medium whitespace-nowrap text-white"
								>
									Install Nixploy
									<ArrowRight className="size-4" />
								</Link>
							</ShimmerButton>
							<Button asChild variant="outline" size="lg" className="h-12 rounded-xl px-6">
								<Link href="/docs">Read the docs</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
