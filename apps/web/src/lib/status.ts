import type { StatusDotStatus } from "@/components/shell";

/** Deployment status ("running" | "done" | "error" | "cancelled") → StatusDot. */
export const deploymentStatusDot: Record<string, StatusDotStatus> = {
	queued: "neutral",
	running: "info",
	done: "success",
	error: "error",
	cancelled: "neutral",
};

/**
 * Deployment status → the label the panel shows everywhere (UX audit F26).
 * `done` reads as "Succeeded" next to Failed / Cancelled, never as "Done".
 */
export const deploymentStatusLabel: Record<string, string> = {
	queued: "Queued",
	running: "Running",
	done: "Succeeded",
	error: "Failed",
	cancelled: "Cancelled",
};

/** Schedule run status ("running" | "success" | "error") → StatusDot. */
export const scheduleRunStatusDot: Record<string, StatusDotStatus> = {
	running: "info",
	success: "success",
	error: "error",
};
