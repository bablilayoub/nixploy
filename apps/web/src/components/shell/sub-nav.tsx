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

/**
 * Segmented pill sub-navigation rendered under the top navbar. Use on
 * settings pages and anywhere a page needs tab routing.
 */
export function SubNav({ items, className }: { items: SubNavItem[]; className?: string }) {
	const pathname = usePathname();

	return (
		<nav className={cn("flex items-center gap-1 overflow-x-auto", className)}>
			{items.map((item) => {
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
			})}
		</nav>
	);
}
