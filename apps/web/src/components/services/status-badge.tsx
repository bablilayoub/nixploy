import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { deploymentStatusDot, deploymentStatusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

type ServiceStatus = "idle" | "running" | "done" | "error" | null | undefined;

type ServiceStatusStyle = {
	label: string;
	status: StatusDotStatus;
	variant: "secondary" | "default" | "destructive";
};

/** Also the fallback for a status the panel does not know yet. */
const SERVICE_STATUS_IDLE: ServiceStatusStyle = {
	label: "Idle",
	status: "neutral",
	variant: "secondary",
};

const serviceStatusConfig: Record<string, ServiceStatusStyle> = {
	idle: SERVICE_STATUS_IDLE,
	running: { label: "Running", status: "success", variant: "default" },
	// Legacy post-deploy status — treat as healthy/running in the UI.
	done: { label: "Running", status: "success", variant: "default" },
	error: { label: "Error", status: "error", variant: "destructive" },
};

export function ServiceStatusBadge({ status }: { status: ServiceStatus }) {
	const config = serviceStatusConfig[status ?? "idle"] ?? SERVICE_STATUS_IDLE;

	return (
		<Badge variant={config.variant} className="gap-1.5 font-medium">
			<StatusDot status={config.status} className="bg-current ring-0 shadow-none" />
			{config.label}
		</Badge>
	);
}

type DeploymentStatus = "queued" | "running" | "done" | "error" | "cancelled" | null | undefined;

type BadgeVariant = "secondary" | "default" | "destructive";

/**
 * Only the badge treatment lives here — the words come from
 * `deploymentStatusLabel`, so the badge, the dashboard list and the log drawer
 * cannot drift apart again (the badge used to say "Error" where the rest of
 * the panel said "Failed").
 */
const deploymentBadgeVariant: Record<string, BadgeVariant> = {
	queued: "secondary",
	// Neutral tones and explicit labels keep the same status vocabulary as the dashboard.
	running: "secondary",
	done: "default",
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
		<Badge variant={deploymentBadgeVariant[key] ?? "default"} className="gap-1.5 font-medium">
			{/* Only work in flight pulses; a finished deployment is a static fact. */}
			<StatusDot
				status={dot}
				className={cn("bg-current ring-0 shadow-none", key === "running" && "animate-pulse")}
			/>
			{label}
		</Badge>
	);
}
