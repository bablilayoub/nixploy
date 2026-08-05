import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Page header — title + optional description on the left,
 * actions on the right, optional breadcrumb row above. Pair with <SubNav>
 * for pages that need tabs.
 */
export function PageHeader({
	title,
	description,
	actions,
	breadcrumb,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	breadcrumb?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			{breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
					{description && <p className="text-sm text-muted-foreground">{description}</p>}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
		</div>
	);
}
