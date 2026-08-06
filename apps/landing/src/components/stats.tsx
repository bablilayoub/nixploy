"use client";

import { BlurFade } from "@/components/magicui/blur-fade";
import { NumberTicker } from "@/components/magicui/number-ticker";

const items = [
	{ value: 1, suffix: " cmd", label: "to install on any Linux host" },
	{ value: 86, suffix: "+", label: "one-click templates in the catalog" },
	{ value: 100, suffix: "%", label: "self-hosted — your servers, your data" },
];

export function Stats() {
	return (
		<section className="border-y border-white/10 bg-white/[0.02]">
			<div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:grid-cols-3 sm:gap-8 sm:px-6">
				{items.map((item, i) => (
					<BlurFade key={item.label} delay={0.05 * i} inView>
						<div className="text-center sm:text-left">
							<div className="text-4xl font-semibold tracking-tighter text-white sm:text-5xl">
								<NumberTicker value={item.value} />
								{item.suffix}
							</div>
							<p className="mt-2 text-sm text-neutral-500">{item.label}</p>
						</div>
					</BlurFade>
				))}
			</div>
		</section>
	);
}
