"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export const mainNavItems = [
	{ label: "Projects", href: "/dashboard" },
	{ label: "Templates", href: "/dashboard/templates" },
	{ label: "Docker", href: "/dashboard/docker" },
	{ label: "Settings", href: "/dashboard/settings" },
];

function isActive(pathname: string, href: string) {
	if (href === "/dashboard") {
		return pathname === "/dashboard" || pathname.startsWith("/dashboard/projects");
	}
	return pathname === href || pathname.startsWith(`${href}/`);
}

/** Primary navigation links rendered inside the top navbar (desktop). */
export function NavMain({ className }: { className?: string }) {
	const pathname = usePathname();

	return (
		<nav className={cn("flex items-center gap-1", className)}>
			{mainNavItems.map((item) => (
				<Link
					key={item.href}
					href={item.href}
					className={cn(
						"rounded-full px-3.5 py-1.5 text-sm transition-colors",
						isActive(pathname, item.href)
							? "bg-secondary font-medium text-foreground"
							: "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
					)}
				>
					{item.label}
				</Link>
			))}
		</nav>
	);
}

export { NavMain as NavProjects };
