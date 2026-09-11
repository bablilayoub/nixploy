import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ServiceStatus = "idle" | "running" | "done" | "error" | null | undefined;

const serviceStatusConfig: Record<
	string,
	{ label: string; status: StatusDotStatus; variant: "secondary" | "success" | "destructive" }
> = {
	idle: { label: "Idle", status: "neutral", variant: "secondary" },
	running: { label: "Running", status: "success", variant: "success" },
	// Legacy post-deploy status — treat as healthy/running in the UI.
	done: { label: "Running", status: "success", variant: "success" },
	error: { label: "Error", status: "error", variant: "destructive" },
};

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
	const config = serviceStatusConfig[status ?? "idle"] ?? serviceStatusConfig.idle;

	return (
		<Badge variant={config.variant} className="gap-1.5 font-normal">
			<StatusDot
				status={config.status}
				className={cn("ring-0", config.status === "success" && "animate-pulse")}
			/>
			{config.label}
		</Badge>
	);
}

type DeploymentStatus = "queued" | "running" | "done" | "error" | "cancelled" | null | undefined;

const deploymentStatusConfig: Record<
	string,
	{
		label: string;
		status: StatusDotStatus;
		variant: "secondary" | "success" | "destructive" | "info";
	}
> = {
	queued: { label: "Queued", status: "neutral", variant: "secondary" },
	running: { label: "Running", status: "success", variant: "success" },
	// "Succeeded", not "Done" — it reads as an outcome next to Error/Cancelled (UX audit F26).
	done: { label: "Succeeded", status: "info", variant: "info" },
	error: { label: "Error", status: "error", variant: "destructive" },
	cancelled: { label: "Cancelled", status: "neutral", variant: "secondary" },
};

export function DeploymentStatusBadge({
	status,
	queuePosition,
}: {
	status: DeploymentStatus;
	/** 1-based place in the server's deploy line; shown as "Queued (#n)". */
	queuePosition?: number | null;
}) {
	const config = deploymentStatusConfig[status ?? "running"] ?? deploymentStatusConfig.running;
	const label =
		status === "queued" && queuePosition ? `${config.label} (#${queuePosition})` : config.label;

	return (
		<Badge variant={config.variant} className="gap-1.5 font-normal">
			<StatusDot
				status={config.status}
				className={cn("ring-0", config.status === "success" && "animate-pulse")}
			/>
			{label}
		</Badge>
	);
}
