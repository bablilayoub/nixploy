import { cn } from "@/lib/utils";

/**
 * Tasks-page table chrome from shadcn-admin:
 * optional toolbar above, then optionally a bordered frame around the table,
 * optional footer (pagination) below — never a padded card with bg.
 */
export function TableCard({
	className,
	children,
	toolbar,
	footer,
	/** When false, skip the rounded border frame (use inside SettingsSection). */
	framed = true,
}: {
	className?: string;
	children: React.ReactNode;
	toolbar?: React.ReactNode;
	footer?: React.ReactNode;
	framed?: boolean;
}) {
	return (
		<div className={cn("flex flex-col gap-4", className)}>
			{toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
			{framed ? <div className="overflow-hidden rounded-md border">{children}</div> : children}
			{footer}
		</div>
	);
}
