import { eq } from "drizzle-orm";
import { db } from "../../db";
import { registry } from "../../db/schema";
import { execAsyncWithStdin } from "../../utils/exec";
import type { DeploymentContext } from "./context";
import { shellQuote } from "./paths";
import { rollbackVersion } from "./rollback";

/**
 * Optional registry push (product audit, Deploy #4).
 *
 * A built image only exists on the node that built it. With `replicas > 1`
 * across unpinned nodes — or after a node swap — Swarm schedules a task
 * somewhere that cannot pull `<appName>:latest`. When the application names
 * a `pushRegistryId`, the build is tagged into that registry's namespace,
 * pushed, and the pushed reference (not the local tag) is what the service
 * spec and the rollback pin record.
 *
 * Credentials go to `docker login --password-stdin` over the command's
 * stdin — never argv, where `ps` exposes them to every user of that host.
 */

export type PushRegistryRow = typeof registry.$inferSelect;

/** Trim a stored prefix to `host/namespace` (no scheme, no trailing slash). */
export function normalizeImagePrefix(prefix: string): string {
	return prefix
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
		.replace(/\/+$/, "");
}

/**
 * Full pushed reference for a deployment: `<prefix>/<appName>:<version>`,
 * where `version` is the same short, tag-safe deployment id the local
 * rollback pins use — so history, registry and rollback all agree.
 */
export function buildPushRef(prefix: string, appName: string, deploymentId: string): string {
	return `${normalizeImagePrefix(prefix)}/${appName}:${rollbackVersion(deploymentId)}`;
}

/** Exact `docker tag` line. */
export const buildTagCommand = (localTag: string, pushRef: string): string =>
	`docker tag ${shellQuote(localTag)} ${shellQuote(pushRef)}`;

/** Exact `docker push` line. */
export const buildPushCommand = (pushRef: string): string => `docker push ${shellQuote(pushRef)}`;

/** Exact `docker login` line; the password is written to the command's stdin. */
export const buildLoginCommand = (serverAddress: string, username: string): string =>
	`docker login ${shellQuote(serverAddress)} -u ${shellQuote(username)} --password-stdin`;

/** Registry host a `docker login` should target for this row. */
export function loginServerAddress(
	row: Pick<PushRegistryRow, "registryUrl" | "imagePrefix">,
): string {
	const url = row.registryUrl?.trim();
	if (url) return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
	const prefix = normalizeImagePrefix(row.imagePrefix ?? "");
	const first = prefix.split("/")[0] ?? "";
	// A prefix like `my-org` is a Docker Hub namespace, not a registry host.
	if (first.includes(".") || first.includes(":") || first === "localhost") return first;
	return "docker.io";
}

/** Load the push target, or null when the application has none configured. */
export async function resolvePushRegistry(
	pushRegistryId: string | null | undefined,
): Promise<PushRegistryRow | null> {
	if (!pushRegistryId) return null;
	const row = await db.query.registry.findFirst({
		where: eq(registry.registryId, pushRegistryId),
	});
	if (!row) throw new Error("Configured push registry not found");
	if (!row.imagePrefix?.trim()) {
		throw new Error(
			`Registry "${row.registryName}" has no image prefix — set one before using it as a push target`,
		);
	}
	return row;
}

export interface PushBuiltImageInput {
	appName: string;
	deploymentId: string;
	/** Local tag the builder produced (`<appName>:latest`). */
	localTag: string;
	registryRow: PushRegistryRow;
}

/**
 * Tag + push the built image. Returns the pushed reference, which the caller
 * runs in the Swarm spec so any node can pull it.
 */
export async function pushBuiltImage(
	ctx: DeploymentContext,
	input: PushBuiltImageInput,
): Promise<string> {
	const row = input.registryRow;
	const pushRef = buildPushRef(row.imagePrefix ?? "", input.appName, input.deploymentId);
	ctx.logger.addSecret(row.password);

	ctx.logger.line(`Logging in to ${loginServerAddress(row)}...`);
	await execAsyncWithStdin(buildLoginCommand(loginServerAddress(row), row.username), row.password, {
		serverId: ctx.serverId ?? null,
	});

	ctx.logger.line(`Pushing ${pushRef}...`);
	await ctx.run(buildTagCommand(input.localTag, pushRef));
	await ctx.run(buildPushCommand(pushRef));
	ctx.logger.line(`Pushed ${pushRef}`);
	return pushRef;
}
