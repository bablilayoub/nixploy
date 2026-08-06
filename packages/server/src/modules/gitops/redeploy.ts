import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, environments } from "../../db/schema";
import { queueDeployment } from "../deployment";
import type { ApplyStackResult } from "./apply";

export type RedeployFromApplyResult = {
	deploymentIds: string[];
	skipped: string[];
};

/**
 * Queue redeploys for applications/compose that were created or updated by a
 * GitOps apply. Databases are skipped (no deploy queue).
 */
export async function redeployChangedFromApply(
	result: ApplyStackResult,
): Promise<RedeployFromApplyResult> {
	const environment = await db.query.environments.findFirst({
		where: and(
			eq(environments.projectId, result.projectId),
			eq(environments.name, result.environmentName),
		),
	});
	if (!environment) {
		throw new Error(`Environment "${result.environmentName}" not found`);
	}

	const deploymentIds: string[] = [];
	const skipped: string[] = [];

	for (const item of result.items) {
		if (item.action === "noop") continue;
		if (item.kind === "application") {
			const app = await db.query.applications.findFirst({
				where: and(
					eq(applications.environmentId, environment.environmentId),
					eq(applications.name, item.name),
				),
			});
			if (!app) {
				skipped.push(`application:${item.name}`);
				continue;
			}
			deploymentIds.push(
				await queueDeployment({ applicationId: app.applicationId, type: "redeploy" }),
			);
			continue;
		}
		if (item.kind === "compose") {
			const row = await db.query.compose.findFirst({
				where: and(
					eq(compose.environmentId, environment.environmentId),
					eq(compose.name, item.name),
				),
			});
			if (!row) {
				skipped.push(`compose:${item.name}`);
				continue;
			}
			deploymentIds.push(await queueDeployment({ composeId: row.composeId, type: "redeploy" }));
			continue;
		}
		skipped.push(`${item.kind}:${item.name}`);
	}

	return { deploymentIds, skipped };
}

/** Fetch a stack YAML document from an HTTPS URL (e.g. raw GitHub). */
export async function fetchStackYamlFromUrl(url: string): Promise<string> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("Invalid stack URL");
	}
	if (parsed.protocol !== "https:") {
		throw new Error("Stack URL must be https");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	try {
		const res = await fetch(url, {
			signal: controller.signal,
			headers: { Accept: "text/plain, text/yaml, application/yaml, */*" },
			redirect: "follow",
		});
		if (!res.ok) {
			throw new Error(`Failed to fetch stack YAML (${res.status})`);
		}
		const text = await res.text();
		if (!text.trim()) {
			throw new Error("Remote stack YAML is empty");
		}
		return text;
	} finally {
		clearTimeout(timer);
	}
}
