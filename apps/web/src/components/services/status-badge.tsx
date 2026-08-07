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

type DeploymentStatus = "running" | "done" | "error" | "cancelled" | null | undefined;

const deploymentStatusConfig: Record<
	string,
	{
		label: string;
		status: StatusDotStatus;
		variant: "secondary" | "success" | "destructive" | "info";
	}
> = {
	running: { label: "Running", status: "success", variant: "success" },
	done: { label: "Done", status: "info", variant: "info" },
	error: { label: "Error", status: "error", variant: "destructive" },
	cancelled: { label: "Cancelled", status: "neutral", variant: "secondary" },
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
	const config = deploymentStatusConfig[status ?? "running"] ?? deploymentStatusConfig.running;

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
