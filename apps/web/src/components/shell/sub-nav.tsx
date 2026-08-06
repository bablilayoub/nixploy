"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface SubNavItem {
	label: string;
	href: string;
	/** Match only the exact pathname instead of a prefix match. */
	exact?: boolean;
}

export interface SubNavGroup {
	label: string;
	items: SubNavItem[];
}

/**
 * Segmented pill sub-navigation rendered under the top navbar. Use on
 * settings pages and anywhere a page needs tab routing.
 */
export function SubNav({
	items,
	groups,
	className,
}: {
	items?: SubNavItem[];
	/** Optional labeled groups (settings Identity / Infra / Integrations). */
	groups?: SubNavGroup[];
	className?: string;
}) {
	const pathname = usePathname();

	const renderItems = (navItems: SubNavItem[]) =>
		navItems.map((item) => {
			const isActive = item.exact
				? pathname === item.href
				: pathname === item.href || pathname.startsWith(`${item.href}/`);
			return (
				<Link
					key={item.href}
					href={item.href}
					className={cn(
						"whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors",
						isActive
							? "bg-foreground font-medium text-background"
							: "text-muted-foreground hover:bg-secondary hover:text-foreground",
					)}
				>
					{item.label}
				</Link>
			);
		});

	if (groups && groups.length > 0) {
		return (
			<nav className={cn("flex flex-col gap-3", className)}>
				{groups.map((group) => (
					<div key={group.label} className="flex flex-wrap items-center gap-2">
						<span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
							{group.label}
						</span>
						<div className="flex items-center gap-1 overflow-x-auto">
							{renderItems(group.items)}
						</div>
					</div>
				))}
			</nav>
		);
	}

	return (
		<nav className={cn("flex flex-wrap items-center gap-1", className)}>
			{renderItems(items ?? [])}
		</nav>
	);
}
