import { EventEmitter } from "node:events";
import type { deploymentStatus } from "../../db/schema/enums";

export type DeploymentStatus = (typeof deploymentStatus.enumValues)[number];

/** Emitted on every output chunk produced by a deployment. */
export interface DeploymentLogEvent {
	deploymentId: string;
	chunk: string;
}

/** Emitted exactly once when a deployment reaches a terminal state. */
export interface DeploymentFinishEvent {
	deploymentId: string;
	status: Exclude<DeploymentStatus, "running">;
}

export interface DeploymentEvents {
	on(event: "log", listener: (e: DeploymentLogEvent) => void): this;
	on(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	emit(event: "log", e: DeploymentLogEvent): boolean;
	emit(event: "finish", e: DeploymentFinishEvent): boolean;
}

/**
 * Global deployment event bus. The WS layer subscribes to `log`/`finish`
 * to stream build output to browsers; the queue and worker publish.
 */
export const deploymentEvents = new EventEmitter() as EventEmitter & DeploymentEvents;
deploymentEvents.setMaxListeners(500);
