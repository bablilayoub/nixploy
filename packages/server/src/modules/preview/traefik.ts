import { eq } from "drizzle-orm";
import { db } from "../../db";
import { domains, previewDeployments, redirects, security } from "../../db/schema";
import { removeTraefikConfig, toTraefikDomainEntry, writeAppTraefikConfig } from "../traefik";

/**
 * (Re)write the Traefik YAML of one PR preview from its own domain row plus
 * the PARENT application's redirects and basic-auth rows: the preview runs
 * the parent's fully merged env (production secrets), so it must sit behind
 * the same auth at its predictable `pr-<n>-<app>.<wildcard>` host. The
 * file is removed when the preview has no domain. Writes go through
 * `writeAppTraefikConfig`, so they are atomic (tmp + rename) and skipped
 * when the rendered YAML is unchanged — safe to call on every worker pass.
 *
 * Leaf module (no deploy-engine import) so the worker, the preview
 * lifecycle and the domain router can all call it without cycles.
 */
export async function syncPreviewTraefik(previewDeploymentId: string): Promise<void> {
	const preview = await db.query.previewDeployments.findFirst({
		where: eq(previewDeployments.previewDeploymentId, previewDeploymentId),
	});
	if (!preview) return;

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
