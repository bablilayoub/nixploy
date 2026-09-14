import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { deploymentStatusDot, deploymentStatusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

type ServiceStatus = "idle" | "running" | "done" | "error" | null | undefined;

type ServiceStatusStyle = {
	label: string;
	status: StatusDotStatus;
	variant: "secondary" | "success" | "destructive";
};

/** Also the fallback for a status the panel does not know yet. */
const SERVICE_STATUS_IDLE: ServiceStatusStyle = {
	label: "Idle",
	status: "neutral",
	variant: "secondary",
};

const serviceStatusConfig: Record<string, ServiceStatusStyle> = {
	idle: SERVICE_STATUS_IDLE,
	running: { label: "Running", status: "success", variant: "success" },
	// Legacy post-deploy status — treat as healthy/running in the UI.
	done: { label: "Running", status: "success", variant: "success" },
	error: { label: "Error", status: "error", variant: "destructive" },
};

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
	const config = serviceStatusConfig[status ?? "idle"] ?? SERVICE_STATUS_IDLE;

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

type BadgeVariant = "secondary" | "success" | "destructive" | "info";

/**
 * Only the badge colour lives here — the words come from
 * `deploymentStatusLabel`, so the badge, the dashboard list and the log drawer
 * cannot drift apart again (the badge used to say "Error" where the rest of
 * the panel said "Failed").
 */
const deploymentBadgeVariant: Record<string, BadgeVariant> = {
	queued: "secondary",
	// Blue while it runs, green once it succeeded — the same reading as the dots
	// in the dashboard list, which had the two colours the other way round here.
	running: "info",
	done: "success",
	error: "destructive",
	cancelled: "secondary",
};

export function DeploymentStatusBadge({
	status,
	queuePosition,
}: {
	status: DeploymentStatus;
	/** 1-based place in the server's deploy line; shown as "Queued (#n)". */
	queuePosition?: number | null;
}) {
	const key = status ?? "running";
	const dot = deploymentStatusDot[key] ?? "neutral";
	const base = deploymentStatusLabel[key] ?? "Running";
	const label = key === "queued" && queuePosition ? `${base} (#${queuePosition})` : base;

	return (
		<Badge variant={deploymentBadgeVariant[key] ?? "success"} className="gap-1.5 font-normal">
			{/* Only work in flight pulses; a finished deployment is a static fact. */}
			<StatusDot status={dot} className={cn("ring-0", key === "running" && "animate-pulse")} />
			{label}
		</Badge>
	);
}
