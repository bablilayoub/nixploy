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
		<header data-slot="page-header" className={cn("mb-1 flex min-w-0 flex-col gap-4", className)}>
			{breadcrumb && <div className="text-xs leading-5 text-muted-foreground">{breadcrumb}</div>}
			<div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
				<div className="status-spine flex min-w-0 flex-1 flex-col gap-2 ps-4">
					<h1 className="text-[1.75rem] leading-8 font-semibold tracking-tight wrap-anywhere">
						{title}
					</h1>
					{/* Wraps rather than truncates: page descriptions carry links and
					    real instructions, and the Servers page was cut mid-word with no
					    way to read the rest (a title attribute only helps plain strings). */}
					{description ? (
						<p
							className="max-w-3xl text-sm leading-6 text-muted-foreground"
							title={descriptionTitle}
						>
							{description}
						</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
				) : null}
			</div>
		</header>
	);
}
