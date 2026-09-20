"use client";

import { FileClock, KeyRound, Lock, Palette, ShieldCheck, Users } from "lucide-react";

import SpotlightCards, { type SpotlightItem } from "@/components/kokonutui/spotlight-cards";
import { openCore } from "@/lib/landing-data";

/*
 * The governance half, in @kokonutui/spotlight-cards. Stated as what Nixploy
 * includes — the comparison pages are the place for named products.
 */
const icons = [KeyRound, Users, ShieldCheck, FileClock, Palette, Lock];

const items: SpotlightItem[] = openCore.map((entry, index) => ({
	icon: icons[index] ?? Lock,
	title: entry.title,
	description: entry.text,
	color: "#5b8cff",
}));

export function Platform() {
	return (
		<section id="open" className="px-6 py-20 lg:py-28">
			<div className="mx-auto max-w-7xl">
				<SpotlightCards
					items={items}
					eyebrow="All of it"
					heading="There is no enterprise tier"
					className="border border-white/10"
				/>
			</div>
		</section>
	);
}
