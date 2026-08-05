import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { cn } from "@/lib/utils";

type ServiceStatus = "idle" | "running" | "done" | "error" | null | undefined;

const serviceStatusConfig: Record<string, { label: string; status: StatusDotStatus }> = {
	idle: { label: "Idle", status: "neutral" },
	running: { label: "Running", status: "success" },
	done: { label: "Done", status: "info" },
	error: { label: "Error", status: "error" },
};

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
	const config = serviceStatusConfig[status ?? "idle"] ?? serviceStatusConfig.idle;

	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
			<StatusDot
				status={config.status}
				className={cn(config.status === "success" && "animate-pulse")}
			/>
			{config.label}
		</span>
	);
}

type DeploymentStatus = "running" | "done" | "error" | "cancelled" | null | undefined;

const deploymentStatusConfig: Record<string, { label: string; status: StatusDotStatus }> = {
	running: serviceStatusConfig.running,
	done: serviceStatusConfig.done,
	error: serviceStatusConfig.error,
	cancelled: { label: "Cancelled", status: "neutral" },
};

export function DeploymentStatusBadge({ status }: { status: DeploymentStatus }) {
	const config = deploymentStatusConfig[status ?? "running"] ?? deploymentStatusConfig.running;

	return (
		<span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
			<StatusDot
				status={config.status}
				className={cn(config.status === "success" && "animate-pulse")}
			/>
			{config.label}
		</span>
	);
}
