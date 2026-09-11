import { eq } from "drizzle-orm";
import { db } from "../../db";
import { compose, domains, previewDeployments, redirects, security } from "../../db/schema";
import { traefikAppName } from "../compose/commands";
import { removeTraefikConfig, toTraefikDomainEntry, writeAppTraefikConfig } from "../traefik";

/**
 * (Re)write the Traefik YAML of one PR preview from its own domain row(s)
 * plus the PARENT's redirects and basic-auth rows: the preview runs the
 * parent's fully merged env (production secrets), so it must sit behind the
 * same auth at its predictable `pr-<n>-<app>…<wildcard>` host(s). The file is
 * removed when the preview has no domain. Writes go through
 * `writeAppTraefikConfig`, so they are atomic (tmp + rename) and skipped
 * when the rendered YAML is unchanged — safe to call on every worker pass.
 *
 * An application preview has exactly one route, written under the preview's
 * own `appName`. A compose preview has one route per compose service that is
 * exposed in production, each written under the same `<project>-<service>` /
 * `<project>_<service>` key the compose deploy gives it as a network alias —
 * with the preview's project name, so it never touches production's files.
 *
 * Leaf module (no deploy-engine import) so the worker, the preview
 * lifecycle and the domain router can all call it without cycles.
 */
export async function syncPreviewTraefik(previewDeploymentId: string): Promise<void> {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) return;

	if (preview.composeId) {
		await syncComposePreviewTraefik(
			preview.previewDeploymentId,
			preview.appName,
			preview.composeId,
		);
		return;
	}
	if (!preview.applicationId) return;

	const [domain, parentRedirects, parentSecurity] = await Promise.all([
		db.query.domains.findFirst({
			where: eq(domains.previewDeploymentId, previewDeploymentId),
			with: { middlewares: true },
		}),
		db.query.redirects.findMany({
			where: eq(redirects.applicationId, preview.applicationId),
		}),
		db.query.security.findMany({
			where: eq(security.applicationId, preview.applicationId),
		}),
	]);

	if (!domain) {
		await removeTraefikConfig(preview.appName);
		return;
	}

	await writeAppTraefikConfig({
		appName: preview.appName,
		domains: [toTraefikDomainEntry(domain)],
		redirects: parentRedirects.map((redirect) => ({
			regex: redirect.regex,
			replacement: redirect.replacement,
			permanent: redirect.permanent,
		})),
		basicAuth: parentSecurity.map((entry) => ({
			username: entry.username,
			password: entry.password,
		})),
	});
}

/** One Traefik file per exposed compose service of a preview project. */
async function syncComposePreviewTraefik(
	previewDeploymentId: string,
	previewAppName: string,
	composeId: string,
): Promise<void> {
	const parent = await db.query.compose.findFirst({ where: eq(compose.composeId, composeId) });
	if (!parent) return;

	const [previewDomains, parentRedirects, parentSecurity] = await Promise.all([
		db.query.domains.findMany({
			where: eq(domains.previewDeploymentId, previewDeploymentId),
			with: { middlewares: true },
		}),
		db.query.redirects.findMany({ where: eq(redirects.composeId, composeId) }),
		db.query.security.findMany({ where: eq(security.composeId, composeId) }),
	]);

	const byService = new Map<string, typeof previewDomains>();
	for (const domain of previewDomains) {
		if (!domain.serviceName) continue;
		const list = byService.get(domain.serviceName) ?? [];
		list.push(domain);
		byService.set(domain.serviceName, list);
	}

	for (const [serviceName, serviceDomains] of byService) {
		await writeAppTraefikConfig({
			appName: composePreviewTraefikKey(parent.composeType, previewAppName, serviceName),
			serverId: parent.serverId,
			// Cleared for the same reason production's compose configs clear it
			// (`compose/service.ts#resyncComposeDomains`): the config key already
			// is the resolvable upstream name — here the PREVIEW project's alias.
			domains: serviceDomains.map((domain) => ({
				...toTraefikDomainEntry(domain),
				serviceName: null,
			})),
			redirects: parentRedirects
				.filter((redirect) => redirect.serviceName === serviceName)
				.map((redirect) => ({
					regex: redirect.regex,
					replacement: redirect.replacement,
					permanent: redirect.permanent,
				})),
			basicAuth: parentSecurity
				.filter((entry) => entry.serviceName === serviceName)
				.map((entry) => ({ username: entry.username, password: entry.password })),
		});
	}
}

/** Traefik config key of one preview compose service (production's shape, preview's project). */
export function composePreviewTraefikKey(
	composeType: "docker-compose" | "stack",
	previewAppName: string,
	serviceName: string,
): string {
	return traefikAppName({ appName: previewAppName, composeType }, serviceName);
}

/**
 * Remove every Traefik file a preview owns. Application previews have one,
 * keyed by the preview's `appName`; compose previews have one per service
 * that carried a preview domain.
 */
export async function removePreviewTraefik(preview: {
	previewDeploymentId: string;
	appName: string;
	composeId: string | null;
}): Promise<void> {
	if (!preview.composeId) {
		await removeTraefikConfig(preview.appName);
		return;
	}
	const parent = await db.query.compose.findFirst({
		where: eq(compose.composeId, preview.composeId),
		columns: { composeType: true, serverId: true },
	});
	const previewDomains = await db.query.domains.findMany({
		where: eq(domains.previewDeploymentId, preview.previewDeploymentId),
		columns: { serviceName: true },
	});
	const keys = new Set<string>();
	for (const domain of previewDomains) {
		if (!domain.serviceName) continue;
		keys.add(
			composePreviewTraefikKey(
				parent?.composeType ?? "docker-compose",
				preview.appName,
				domain.serviceName,
			),
		);
	}
	// Also sweep the bare project name: harmless when nothing was written
	// there, and it catches a preview whose domains were deleted first.
	keys.add(preview.appName);
	for (const key of keys) {
		await removeTraefikConfig(key, parent?.serverId ?? null);
	}
}
