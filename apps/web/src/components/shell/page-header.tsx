import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Page header — title + optional description on the left,
 * actions on the right, optional breadcrumb row above. Pair with <SubNav>
 * for pages that need secondary navigation.
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
	const descriptionTitle =
		typeof description === "string" && description.length > 0 ? description : undefined;

	return (
		<div className={cn("mb-2 flex flex-col gap-1 space-y-2", className)}>
			{breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
					{/* Wraps rather than truncates: page descriptions carry links and
					    real instructions, and the Servers page was cut mid-word with no
					    way to read the rest (a title attribute only helps plain strings). */}
					{description ? (
						<p className="text-sm text-muted-foreground" title={descriptionTitle}>
							{description}
						</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
				) : null}
			</div>
		</div>
	);
}
