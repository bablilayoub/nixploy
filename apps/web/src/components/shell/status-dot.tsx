import { cn } from "@/lib/utils";

export type StatusDotStatus = "success" | "warning" | "error" | "info" | "neutral";

const statusColors: Record<StatusDotStatus, string> = {
	success: "bg-success",
	warning: "bg-warning",
	error: "bg-destructive",
	info: "bg-info",
	neutral: "bg-muted-foreground/40",
};

/**
 * Status indicator — a small colored dot instead of a pill
 * badge. Pair with a text label.
 */
export function StatusDot({ status, className }: { status: StatusDotStatus; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn("inline-block size-2 shrink-0 rounded-full", statusColors[status], className)}
		/>
	);
}
