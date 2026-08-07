"use client";

import { BlurFade } from "@/components/magicui/blur-fade";
import { NumberTicker } from "@/components/magicui/number-ticker";

const stats = [
	{ value: 1, suffix: "", label: "curl to install" },
	{ value: 7, suffix: "+", label: "service types" },
	{ value: 100, suffix: "%", label: "your infrastructure" },
	{ value: 0, suffix: "", label: "vendor lock-in" },
] as const;

export function Stats() {
	return (
		<section className="border-t border-white/8 py-16 sm:py-20">
			<div className="mx-auto max-w-6xl px-5 sm:px-6">
				<BlurFade>
					<ul className="grid grid-cols-2 gap-8 lg:grid-cols-4">
						{stats.map((stat) => (
							<li key={stat.label} className="text-center">
								<p className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
									<NumberTicker value={stat.value} />
									{stat.suffix}
								</p>
								<p className="mt-2 text-sm text-neutral-500">{stat.label}</p>
							</li>
						))}
					</ul>
				</BlurFade>
			</div>
		</section>
	);
}
