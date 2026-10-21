import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon?: LucideIcon;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-5 py-10 text-center">
			{Icon && (
				<span className="mb-1 flex size-12 items-center justify-center rounded-lg border bg-panel-inset">
					<Icon aria-hidden="true" className="size-5 text-muted-foreground" />
				</span>
			)}
			<h3 className="text-base font-semibold tracking-tight">{title}</h3>
			{description && (
				<p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
			)}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
