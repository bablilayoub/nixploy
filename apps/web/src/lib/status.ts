import type { StatusDotStatus } from "@/components/shell";

/** Deployment status ("running" | "done" | "error" | "cancelled") → StatusDot. */
export const deploymentStatusDot: Record<string, StatusDotStatus> = {
	running: "info",
	done: "success",
	error: "error",
	cancelled: "neutral",
};

/** Service status ("idle" | "running" | "done" | "error") → StatusDot. */
export const serviceStatusDot: Record<string, StatusDotStatus> = {
	idle: "neutral",
	running: "success",
	done: "info",
	error: "error",
};

/** Schedule run status ("running" | "success" | "error") → StatusDot. */
export const scheduleRunStatusDot: Record<string, StatusDotStatus> = {
	running: "info",
	success: "success",
	error: "error",
};
