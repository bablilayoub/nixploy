"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface SubNavItem {
	label: string;
	href: string;
	icon?: LucideIcon;
	/** Match only the exact pathname instead of a prefix match. */
	exact?: boolean;
}

export interface SubNavGroup {
	label: string;
	items: SubNavItem[];
}

/**
 * Segmented sub-navigation for settings and similar tab routing.
 * Horizontal pills by default; pass orientation="vertical" for a side menu.
 */
export function SubNav({
	items,
	groups,
	orientation = "horizontal",
	className,
}: {
	items?: SubNavItem[];
	/** Optional labeled groups (settings Identity / Infra / Integrations). */
	groups?: SubNavGroup[];
	orientation?: "horizontal" | "vertical";
	className?: string;
}) {
	const pathname = usePathname();
	const vertical = orientation === "vertical";

	const renderItems = (navItems: SubNavItem[]) =>
		navItems.map((item) => {
			const isActive = item.exact
				? pathname === item.href
				: pathname === item.href || pathname.startsWith(`${item.href}/`);
			const Icon = item.icon;
			return (
				<Link
					key={item.href}
					href={item.href}
					aria-current={isActive ? "page" : undefined}
					className={cn(
						"text-sm transition-colors",
						vertical
							? cn(
									"flex min-h-10 items-center gap-2.5 rounded-md border border-transparent px-3 py-2 text-[13px]",
									isActive
										? "border-border bg-card font-semibold text-foreground shadow-xs"
										: "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
								)
							: cn(
									"inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2",
									isActive
										? "border-border border-border bg-card font-semibold text-foreground shadow-xs"
										: "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
								),
					)}
				>
					{Icon ? (
						<Icon
							className={cn(
								"size-4 shrink-0",
								isActive ? "text-foreground" : "text-muted-foreground",
							)}
							aria-hidden
						/>
					) : null}
					{item.label}
				</Link>
			);
		});

	if (groups && groups.length > 0) {
		return (
			<nav
				className={cn(vertical ? "flex flex-col gap-6" : "flex flex-col gap-3", className)}
				aria-label="Secondary"
			>
				{groups.map((group) => (
					<div
						key={group.label}
						className={cn(vertical ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-2")}
					>
						<span
							className={cn(
								"shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
								vertical ? "px-3 pb-0.5" : "",
							)}
						>
							{group.label}
						</span>
						<div
							className={cn(
								vertical ? "flex flex-col gap-0.5" : "flex items-center gap-1 overflow-x-auto",
							)}
						>
							{renderItems(group.items)}
						</div>
					</div>
				))}
			</nav>
		);
	}

	return (
		<nav
			className={cn(
				vertical ? "flex flex-col gap-0.5" : "flex flex-wrap items-center gap-1",
				className,
			)}
			aria-label="Secondary"
		>
			{renderItems(items ?? [])}
		</nav>
	);
}
