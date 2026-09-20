"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A table of contents for a long page of sections, sticky from `lg` and a
 * horizontal strip below it.
 *
 * The current entry is resolved with an `IntersectionObserver` rather than on
 * scroll: the callback fires only when a section crosses the band, so the rail
 * costs nothing while you read. The band is the top third of the viewport —
 * the section whose heading you just passed, which is the one you would point
 * at if asked where you are.
 *
 * Without scripts every entry is still a link to its anchor; only the
 * highlight is missing.
 */
export function SectionRail({
	items,
	className,
}: {
	items: ReadonlyArray<{ id: string; label: string }>;
	className?: string;
}) {
	const [current, setCurrent] = useState<string | null>(null);

	useEffect(() => {
		const sections = items
			.map((item) => document.getElementById(item.id))
			.filter((element): element is HTMLElement => element !== null);
		if (sections.length === 0) return;

		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (visible[0]) setCurrent(visible[0].target.id);
			},
			{ rootMargin: "-88px 0px -66% 0px", threshold: 0 },
		);
		for (const section of sections) observer.observe(section);
		return () => observer.disconnect();
	}, [items]);

	return (
		<nav aria-label="On this page" className={className}>
			<p className="px-3 font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
				Sections
			</p>
			<ul className="mt-3 flex flex-col">
				{items.map((item, index) => {
					const active = current === item.id;
					return (
						<li key={item.id}>
							<a
								href={`#${item.id}`}
								aria-current={active ? "true" : undefined}
								className={cn(
									"flex min-h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
									active
										? "bg-accent font-medium text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<span className="font-mono text-[11px] text-muted-foreground/70">
									{String(index + 1).padStart(2, "0")}
								</span>
								{item.label}
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
