import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, environments } from "../../db/schema";
import { assertPublicHttpsUrl } from "../../utils/public-url";
import { queueDeployment } from "../deployment";
import type { ApplyStackResult } from "./apply";

export type RedeployFromApplyResult = {
	deploymentIds: string[];
	skipped: string[];
};

/**
 * Items an apply actually changed: creates, and updates whose patch was
 * non-empty. Items that failed to apply are never redeployed. Domain items
 * are excluded — they re-sync Traefik directly and need no rebuild.
 */
export function itemsToRedeploy(result: ApplyStackResult): ApplyStackResult["items"] {
	return result.items.filter(
		(item) =>
			(item.kind === "application" || item.kind === "compose") &&
			!item.error &&
			(item.action === "create" || (item.action === "update" && (item.changes?.length ?? 0) > 0)),
	);
}

/**
 * Queue redeploys for applications/compose that were created or updated by a
 * GitOps apply. Databases are skipped (no deploy queue).
 */
export async function redeployChangedFromApply(
	result: ApplyStackResult,
	options: {
		/** User id of whoever ran the apply (recorded as the deployment's `triggeredBy`). */
		triggeredBy?: string | null;
	} = {},
): Promise<RedeployFromApplyResult> {
	const provenance = { trigger: "gitops" as const, triggeredBy: options.triggeredBy ?? null };
	const environment = await db.query.environments.findFirst({
		where: and(
			eq(environments.projectId, result.projectId),
			eq(environments.name, result.environmentName),
		),
	});
	if (!environment) {
		throw new Error(`Environment "${result.environmentName}" not found`);
	}

	const changed = itemsToRedeploy(result);
	const appNames = changed.filter((item) => item.kind === "application").map((item) => item.name);
	const composeNames = changed.filter((item) => item.kind === "compose").map((item) => item.name);

	const [appRows, composeRows] = await Promise.all([
		appNames.length > 0
			? db.query.applications.findMany({
					where: and(
						eq(applications.environmentId, environment.environmentId),
						inArray(applications.name, appNames),
					),
				})
			: Promise.resolve([]),
		composeNames.length > 0
			? db.query.compose.findMany({
					where: and(
						eq(compose.environmentId, environment.environmentId),
						inArray(compose.name, composeNames),
					),
				})
			: Promise.resolve([]),
	]);

	const appByName = new Map(appRows.map((row) => [row.name, row]));
	const composeByName = new Map(composeRows.map((row) => [row.name, row]));

	const deploymentIds: string[] = [];
	const skipped: string[] = [];

	for (const item of changed) {
		if (item.kind === "application") {
			const app = appByName.get(item.name);
			if (!app) {
				skipped.push(`application:${item.name}`);
				continue;
			}
			deploymentIds.push(
				await queueDeployment({
					applicationId: app.applicationId,
					type: "redeploy",
					...provenance,
				}),
			);
			continue;
		}
		if (item.kind === "compose") {
			const row = composeByName.get(item.name);
			if (!row) {
				skipped.push(`compose:${item.name}`);
				continue;
			}
			deploymentIds.push(
				await queueDeployment({ composeId: row.composeId, type: "redeploy", ...provenance }),
			);
			continue;
		}
		skipped.push(`${item.kind}:${item.name}`);
	}

	return { deploymentIds, skipped };
}

/** Upper bound for a fetched stack document — a manifest is a few KB, never megabytes. */
export const MAX_STACK_YAML_BYTES = 1024 * 1024;

/** Read a response body up to `limit` bytes; throws once the limit is exceeded. */
export async function readBodyWithLimit(res: Response, limit: number): Promise<string> {
	const declared = Number.parseInt(res.headers.get("content-length") ?? "", 10);
	if (Number.isFinite(declared) && declared > limit) {
		throw new Error(`Stack YAML is too large (${declared} bytes, limit ${limit})`);
	}
	if (!res.body) return await res.text();
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > limit) {
				throw new Error(`Stack YAML is too large (limit ${limit} bytes)`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
		await res.body.cancel().catch(() => {});
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Fetch a stack YAML document from an HTTPS URL (e.g. raw GitHub). */
export async function fetchStackYamlFromUrl(url: string): Promise<string> {
	try {
		await assertPublicHttpsUrl(url);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Stack URL host is not allowed";
		throw new Error(
			message.replace(/^URL/, "Stack URL").replace(/^Invalid URL$/, "Invalid stack URL"),
		);
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { Accept: "text/plain, text/yaml, application/yaml, */*" },
			redirect: "error",
		});
		if (!res.ok) {
			throw new Error(`Failed to fetch stack YAML (${res.status})`);
		}
		const text = await readBodyWithLimit(res, MAX_STACK_YAML_BYTES);
		if (!text.trim()) {
			throw new Error("Remote stack YAML is empty");
		}
		return text;
	} finally {
		clearTimeout(timer);
	}
}
