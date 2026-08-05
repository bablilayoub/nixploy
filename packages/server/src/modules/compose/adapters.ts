import type { EventEmitter } from "node:events";

/**
 * Adapters for sibling modules that are built in parallel (deploy engine,
 * Traefik writer). They are resolved with a dynamic import at runtime so this
 * module typechecks and runs whether or not the sibling has landed yet.
 * When the sibling is missing the caller falls back to local behavior.
 *
 * The shapes below mirror the locked inter-module contracts exactly.
 */

export interface DeploymentJob {
	applicationId?: string;
	composeId?: string;
	type: "deploy" | "redeploy";
}

export interface DeploymentEngineModule {
	deploymentEvents: EventEmitter;
	queueDeployment(job: DeploymentJob): Promise<string>;
	cancelDeployment(deploymentId: string): Promise<void>;
}

export interface TraefikDomainInput {
	host: string;
	port: number;
	path?: string | null;
	https: boolean;
	certificateType: "letsencrypt" | "none" | "custom";
	certificateId?: string | null;
}

export interface TraefikAppConfigInput {
	appName: string;
	serverId?: string | null;
	domains: TraefikDomainInput[];
	redirects?: Array<{ regex: string; replacement: string; permanent: boolean }>;
	basicAuth?: Array<{ username: string; password: string }>;
}

export interface TraefikModule {
	writeAppTraefikConfig(input: TraefikAppConfigInput): Promise<void>;
	removeTraefikConfig(appName: string, serverId?: string | null): Promise<void>;
}

export async function getDeploymentEngine(): Promise<DeploymentEngineModule | null> {
	try {
		// Sibling module (deploy engine) — may not exist mid-flight.
		const mod = (await import("../deployment/index")) as Partial<DeploymentEngineModule>;
		if (typeof mod?.queueDeployment === "function") {
			return mod as DeploymentEngineModule;
		}
		return null;
	} catch {
		return null;
	}
}

export async function getTraefik(): Promise<TraefikModule | null> {
	try {
		// Sibling module (traefik writer) — may not exist mid-flight.
		const mod = (await import("../traefik/index")) as Partial<TraefikModule>;
		if (
			typeof mod?.writeAppTraefikConfig === "function" &&
			typeof mod?.removeTraefikConfig === "function"
		) {
			return mod as TraefikModule;
		}
		return null;
	} catch {
		return null;
	}
}
