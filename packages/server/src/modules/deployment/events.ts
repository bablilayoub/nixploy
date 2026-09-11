import { EventEmitter } from "node:events";
import type { deploymentStatus } from "../../db/schema/enums";

export type DeploymentStatus = (typeof deploymentStatus.enumValues)[number];

/** Emitted exactly once when a deployment reaches a terminal state. */
export interface DeploymentFinishEvent {
	deploymentId: string;
	status: Exclude<DeploymentStatus, "queued" | "running">;
}

/**
 * Emitted by `DeploymentLogger.write` for every (redacted) chunk appended to
 * a deployment log. The file stays the source of truth — followers use this
 * as a wake-up signal and read the new bytes from disk, so replay and live
 * bytes never race or duplicate.
 */
export interface DeploymentLogEvent {
	deploymentId: string;
	chunk: string;
}

export interface DeploymentEvents {
	on(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	on(event: "log", listener: (e: DeploymentLogEvent) => void): this;
	off(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	off(event: "log", listener: (e: DeploymentLogEvent) => void): this;
	emit(event: "finish", e: DeploymentFinishEvent): boolean;
	emit(event: "log", e: DeploymentLogEvent): boolean;
}

/**
 * Global deployment event bus. Must live on `globalThis` so the custom
 * server (WebSocket handlers) and Next.js request graph (tRPC → worker)
 * share one emitter — otherwise live `finish` frames never reach open sockets.
 */
const globalForDeploy = globalThis as typeof globalThis & {
	__nixployDeploymentEvents?: EventEmitter & DeploymentEvents;
};

export const deploymentEvents =
	globalForDeploy.__nixployDeploymentEvents ??
	(new EventEmitter() as EventEmitter & DeploymentEvents);

if (!globalForDeploy.__nixployDeploymentEvents) {
	deploymentEvents.setMaxListeners(500);
	globalForDeploy.__nixployDeploymentEvents = deploymentEvents;
}
