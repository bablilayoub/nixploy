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

/**
 * Emitted after a `queued` row was inserted (or a queued backlog was found at
 * boot). The durable queue's worker loop polls Postgres on a slow timer and
 * uses this as its wake-up signal, so a deploy starts immediately instead of
 * waiting for the next tick. Carries no payload the worker trusts — it
 * re-reads (and claims) the row from the database.
 */
export interface DeploymentEnqueuedEvent {
	deploymentId: string;
	serverId: string | null;
}

export interface DeploymentEvents {
	on(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	on(event: "log", listener: (e: DeploymentLogEvent) => void): this;
	on(event: "enqueued", listener: (e: DeploymentEnqueuedEvent) => void): this;
	off(event: "finish", listener: (e: DeploymentFinishEvent) => void): this;
	off(event: "log", listener: (e: DeploymentLogEvent) => void): this;
	off(event: "enqueued", listener: (e: DeploymentEnqueuedEvent) => void): this;
	emit(event: "finish", e: DeploymentFinishEvent): boolean;
	emit(event: "log", e: DeploymentLogEvent): boolean;
	emit(event: "enqueued", e: DeploymentEnqueuedEvent): boolean;
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
