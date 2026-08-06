import { EventEmitter } from "node:events";
import type { deploymentStatus } from "../../db/schema/enums";

export type DeploymentStatus = (typeof deploymentStatus.enumValues)[number];

/** Emitted exactly once when a deployment reaches a terminal state. */
export interface DeploymentFinishEvent {
	deploymentId: string;
	status: Exclude<DeploymentStatus, "running">;
}

export interface DeploymentEvents {
	on(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	off(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	emit(event: "finish", e: DeploymentFinishEvent): boolean;
}

/**
 * Global deployment event bus. Must live on `globalThis` so the custom
 * server (WebSocket handlers) and Next.js request graph (tRPC → worker)
 * share one emitter — otherwise live `finish` frames never reach open sockets.
 * Log bytes are streamed from the deployment log file; only terminal status
 * is published here.
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
