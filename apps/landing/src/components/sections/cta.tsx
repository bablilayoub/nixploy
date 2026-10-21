import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Repeat the install action, with documentation as the quieter alternative. */
export function Cta() {
	return (
		<section className="py-20 lg:py-28">
			<div className="container-page">
				<div className="relative overflow-hidden rounded-xl border bg-primary px-6 py-16 text-center text-primary-foreground sm:px-12 sm:py-20">
					<div className="relative">
						<h2 className="mx-auto max-w-2xl text-4xl leading-[1.05] font-semibold tracking-[-0.05em] text-balance lg:text-6xl">
							Rent the box. Keep the rest.
						</h2>
						<p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-primary-foreground/75">
							One command, three services, and the first account is yours.
						</p>
						<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
							<Button
								asChild
								size="lg"
								className="h-12 rounded-md border-primary-foreground/30 bg-primary-foreground px-6 text-base text-primary hover:bg-primary-foreground/85"
							>
								<Link href="/docs/install">
									Install Nixploy
									<ArrowRight className="size-4" />
								</Link>
							</Button>
							<Button
								asChild
								variant="outline"
								size="lg"
								className="h-12 rounded-md border-primary-foreground/30 bg-transparent px-6 text-base text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
							>
								<Link href="/docs">Read the docs</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
