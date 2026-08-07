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
		<div className={cn("flex flex-col gap-1.5", className)}>
			{breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
					{description ? (
						<p className="truncate text-sm text-muted-foreground" title={descriptionTitle}>
							{description}
						</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
				) : null}
			</div>
		</div>
	);
}
