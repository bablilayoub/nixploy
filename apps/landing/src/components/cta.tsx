"use client";

import Link from "next/link";
import { BlurFade } from "@/components/magicui/blur-fade";
import { Particles } from "@/components/magicui/particles";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { site } from "@/lib/site";


export function Cta() {
	return (
		<section className="relative overflow-hidden border-t border-white/10 py-28 sm:py-36">
			<Particles className="absolute inset-0" quantity={40} color="#ffffff" ease={80} />
			<div className="relative mx-auto max-w-6xl px-5 text-center sm:px-6">
				<BlurFade inView>
					<h2 className="text-4xl font-semibold tracking-tighter text-white sm:text-6xl">
						Install Nixploy today
					</h2>
					<p className="mx-auto mt-5 max-w-lg text-lg text-neutral-400">
						One command on your server. Own the stack end to end.
					</p>
					<div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Link href="/install">
							<ShimmerButton
								background="rgba(255,255,255,1)"
								shimmerColor="#000000"
								borderRadius="8px"
							>
								<span className="text-sm font-medium text-black">Install guide</span>
							</ShimmerButton>
						</Link>
						<a
							href={site.github}
							target="_blank"
							rel="noreferrer"
							className="inline-flex h-12 items-center rounded-lg border border-white/15 px-8 text-sm font-medium text-white hover:bg-white/5"
						>
							Star on GitHub
						</a>
					</div>
				</BlurFade>
			</div>
		</section>
	);
}

export function Footer() {
	return (
		<footer className="border-t border-white/10">
			<div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:flex-row sm:items-end sm:justify-between sm:px-6">
				<div>
					<p className="text-lg font-semibold text-white">{site.name}</p>
					<p className="mt-1 max-w-sm text-sm text-neutral-500">{site.inspiredBy}</p>
					<p className="mt-3 text-xs text-neutral-600">
						© {new Date().getFullYear()} Nixploy. Open source under MIT.
					</p>
				</div>
				<nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-500">
					{[
						["/features", "Features"],
						["/pricing", "Pricing"],
						["/docs", "Docs"],
						["/about", "About"],
						["/privacy", "Privacy"],
					].map(([href, label]) => (
						<Link key={href} href={href} className="hover:text-white">
							{label}
						</Link>
					))}
				</nav>
			</div>
		</footer>
	);
}
