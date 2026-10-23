import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Shared data-table composition from the native shadcn Card and Table patterns. */
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
	return (
		<Card
			className={cn(
				"min-w-0 gap-0 overflow-hidden py-0",
				!framed && "border-0 bg-transparent shadow-none",
				className,
			)}
		>
			{toolbar && (
				<CardHeader
					className={cn(
						"flex flex-row flex-wrap items-center gap-2 border-b py-4",
						toolbarFramed && "bg-muted/30",
						!framed && "border-0 px-0 pt-0",
					)}
				>
					{toolbar}
				</CardHeader>
			)}
			<CardContent className="relative overflow-x-auto px-0">{children}</CardContent>
			{footer && <CardFooter className="flex-wrap gap-3 border-t py-4">{footer}</CardFooter>}
		</Card>
	);
}
