import { cn } from "@/lib/utils";

export type StatusDotStatus = "success" | "warning" | "error" | "info" | "neutral";

const statusColors: Record<StatusDotStatus, string> = {
	success: "bg-foreground",
	warning: "border border-foreground bg-transparent rounded-sm",
	error: "bg-foreground rounded-none rotate-45",
	info: "bg-muted-foreground",
	neutral: "border border-muted-foreground bg-transparent",
};

/**
 * Status indicator — a neutral shape instead of a pill
 * badge. Pair with a text label.
 */
export function StatusDot({ status, className }: { status: StatusDotStatus; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block size-1.5 shrink-0 rounded-full ring-2 ring-background",
				statusColors[status],
				className,
			)}
		/>
	);
}
