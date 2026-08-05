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
		<div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
			{Icon && (
				<div className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted">
					<Icon className="size-5 text-muted-foreground" />
				</div>
			)}
			<h3 className="text-sm font-medium">{title}</h3>
			{description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
