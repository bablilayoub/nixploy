import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Native data-table composition: controls, framed rows, then pagination. */
export function TableCard({
	className,
	children,
	toolbar,
	footer,
	framed = true,
	toolbarFramed = false,
}: {
	className?: string;
	children: React.ReactNode;
	toolbar?: React.ReactNode;
	footer?: React.ReactNode;
	framed?: boolean;
	toolbarFramed?: boolean;
}) {
	// Keep all container types stable across loading transitions: toolbar dialogs
	// can own unsaved form state while their table's first query is in flight.
	return (
		<div className={cn("min-w-0 space-y-4", className)}>
			{toolbar && (
				<div
					className={cn(
						"flex min-w-0 flex-wrap items-center gap-2",
						toolbarFramed && "justify-between",
					)}
				>
					{toolbar}
				</div>
			)}
			<Card
				className={cn(
					"min-w-0 gap-0 overflow-hidden py-0",
					!framed && "border-0 bg-transparent shadow-none",
				)}
			>
				<CardContent className="relative overflow-x-auto px-0">{children}</CardContent>
			</Card>
			{footer && (
				<div className="flex min-w-0 flex-wrap items-center justify-between gap-3">{footer}</div>
			)}
		</div>
	);
}
