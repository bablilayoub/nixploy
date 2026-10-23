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
	compactActions = false,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	breadcrumb?: ReactNode;
	compactActions?: boolean;
	className?: string;
}) {
	const descriptionTitle =
		typeof description === "string" && description.length > 0 ? description : undefined;

	return (
		<header className={cn("fieldwork-page-header mb-6 flex min-w-0 flex-col gap-4", className)}>
			{breadcrumb && <div className="text-xs text-muted-foreground">{breadcrumb}</div>}
			<div
				className={cn(
					"flex min-w-0 gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
					compactActions ? "flex-row items-start justify-between" : "flex-col",
				)}
			>
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<h1 className="text-2xl leading-tight font-semibold tracking-tight break-words sm:text-[1.75rem]">
						{title}
					</h1>
					{/* Wraps rather than truncates: page descriptions carry links and
					    real instructions, and the Servers page was cut mid-word with no
					    way to read the rest (a title attribute only helps plain strings). */}
					{description ? (
						<p
							className="max-w-2xl text-sm leading-relaxed text-muted-foreground"
							title={descriptionTitle}
						>
							{description}
						</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end">
						{actions}
					</div>
				) : null}
			</div>
		</header>
	);
}
