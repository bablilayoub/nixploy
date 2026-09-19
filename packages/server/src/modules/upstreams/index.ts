import { eq } from "drizzle-orm";
import { db } from "../../db";
import { domains, type ExternalUpstream, externalUpstreams } from "../../db/schema";
import { createLogger } from "../../lib/logger";
import { conflict, notFound } from "../errors";
import { assertProjectVisible } from "../projects/project-scope";
import { generateAppName } from "../services/app-name";
import { removeTraefikConfig, toTraefikDomainEntry, writeAppTraefikConfig } from "../traefik";
import { assertUpstreamTargetUrl, UpstreamResolveError } from "./target";

export { assertUpstreamTargetUrl, MAX_TARGET_URL_LENGTH, UpstreamResolveError } from "./target";

const log = createLogger("upstreams");

export interface CreateUpstreamInput {
	environmentId: string;
	name: string;
	description?: string | null;
	targetUrl: string;
	passHostHeader?: boolean;
	insecureSkipVerify?: boolean;
}

export interface UpdateUpstreamInput {
	name?: string;
	description?: string | null;
	targetUrl?: string;
	passHostHeader?: boolean;
	insecureSkipVerify?: boolean;
}

export const listUpstreamsByEnvironment = (environmentId: string) =>
	db.query.externalUpstreams.findMany({
		where: eq(externalUpstreams.environmentId, environmentId),
		orderBy: [externalUpstreams.createdAt],
	});

export const findUpstreamById = (externalUpstreamId: string) =>
	db.query.externalUpstreams.findFirst({
		where: eq(externalUpstreams.externalUpstreamId, externalUpstreamId),
		with: { environment: { with: { project: true } } },
	});

/**
 * (Re)write `<appName>.yml` for one upstream from its domain rows. A blocked
 * upstream (see `recheckUpstreamTargets`) has its file removed instead: the
 * domains stay, the route is withheld until the target passes again.
 */
export const syncUpstreamTraefik = async (upstream: ExternalUpstream): Promise<void> => {
	if (upstream.blockedReason) {
		await removeTraefikConfig(upstream.appName);
		return;
	}
	const rows = await db.query.domains.findMany({
		where: eq(domains.externalUpstreamId, upstream.externalUpstreamId),
		with: { middlewares: true },
	});
	await writeAppTraefikConfig({
		appName: upstream.appName,
		domains: rows.map((row) => ({
			...toTraefikDomainEntry(row),
			upstream: {
				url: upstream.targetUrl,
				passHostHeader: upstream.passHostHeader,
				insecureSkipVerify: upstream.insecureSkipVerify,
			},
		})),
	});
};

export const createExternalUpstream = async (
	input: CreateUpstreamInput,
): Promise<ExternalUpstream> => {
	const target = await assertUpstreamTargetUrl(input.targetUrl);
	const appName = await generateAppName(input.name, "upstream");
	const [row] = await db
		.insert(externalUpstreams)
		.values({
			environmentId: input.environmentId,
			name: input.name,
			appName,
			description: input.description ?? null,
			targetUrl: target.url,
			passHostHeader: input.passHostHeader ?? true,
			insecureSkipVerify: input.insecureSkipVerify ?? false,
		})
		.returning();
	if (!row) throw conflict("External upstream could not be created");
	return row;
};

export const updateExternalUpstream = async (
	current: ExternalUpstream,
	patch: UpdateUpstreamInput,
): Promise<ExternalUpstream> => {
	const targetUrl =
		patch.targetUrl !== undefined
			? (await assertUpstreamTargetUrl(patch.targetUrl)).url
			: current.targetUrl;
	const [row] = await db
		.update(externalUpstreams)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.description !== undefined ? { description: patch.description } : {}),
			targetUrl,
			...(patch.passHostHeader !== undefined ? { passHostHeader: patch.passHostHeader } : {}),
			...(patch.insecureSkipVerify !== undefined
				? { insecureSkipVerify: patch.insecureSkipVerify }
				: {}),
			// An edit re-vets the target; a hold from the hourly check is lifted
			// by the same act that would have fixed its cause.
			...(patch.targetUrl !== undefined ? { blockedReason: null } : {}),
		})
		.where(eq(externalUpstreams.externalUpstreamId, current.externalUpstreamId))
		.returning();
	if (!row) throw notFound("External upstream not found");
	await syncUpstreamTraefik(row);
	return row;
};

/** Remove the route, then the row (domains and probes cascade in the DB). */
export const deleteExternalUpstream = async (upstream: ExternalUpstream): Promise<void> => {
	await removeTraefikConfig(upstream.appName);
	await db
		.delete(externalUpstreams)
		.where(eq(externalUpstreams.externalUpstreamId, upstream.externalUpstreamId));
};

/** Traefik files of every upstream in an environment — called by the environment cascade. */
export const removeUpstreamRoutesForEnvironment = async (environmentId: string): Promise<void> => {
	const rows = await listUpstreamsByEnvironment(environmentId);
	for (const row of rows) {
		await removeTraefikConfig(row.appName);
	}
};

/**
 * Hourly: re-run the target policy on every upstream. Traefik resolves the
 * name at request time, so a record re-pointed at the overlay after it was
 * vetted would otherwise stay routable for as long as the row exists. A
 * policy failure withholds the route (`blockedReason`); a name that merely
 * stopped resolving is left alone — that is a DNS outage, not an attack, and
 * pulling the route would turn it into one Nixploy caused.
 */
export async function recheckUpstreamTargets(): Promise<{ blocked: number; restored: number }> {
	const rows = await db.query.externalUpstreams.findMany();
	let blocked = 0;
	let restored = 0;
	for (const row of rows) {
		let reason: string | null = null;
		try {
			await assertUpstreamTargetUrl(row.targetUrl);
		} catch (error) {
			if (error instanceof UpstreamResolveError) continue;
			reason = error instanceof Error ? error.message : String(error);
		}
		if (reason === row.blockedReason) continue;
		const [updated] = await db
			.update(externalUpstreams)
			.set({ blockedReason: reason })
			.where(eq(externalUpstreams.externalUpstreamId, row.externalUpstreamId))
			.returning();
		if (!updated) continue;
		if (reason) {
			blocked += 1;
			log.warn("External upstream target no longer passes the egress policy; route withheld", {
				appName: row.appName,
				reason,
			});
		} else {
			restored += 1;
			log.info("External upstream target passes again; route restored", { appName: row.appName });
		}
		await syncUpstreamTraefik(updated);
	}
	return { blocked, restored };
}

/**
 * Load an upstream and verify org ownership (upstream → environment → project
 * → org), then the caller's project scope. `notFound` either way — a hidden
 * project must not be distinguishable from a missing row.
 */
export const assertUpstreamAccess = async (externalUpstreamId: string, organizationId: string) => {
	const row = await findUpstreamById(externalUpstreamId);
	if (!row || row.environment.project.organizationId !== organizationId) {
		throw notFound("External upstream not found");
	}
	assertProjectVisible(row.environment.projectId, "External upstream");
	return row;
};
