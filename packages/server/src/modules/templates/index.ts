import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { compose, domains, environments } from "../../db/schema";
import { bestEffort } from "../../utils/best-effort";
import {
	assertComposeServiceName,
	assertTraefikHost,
	assertTraefikPath,
} from "../../utils/validators";
import {
	assertSafeComposeSpec,
	hostPrivilegedComposeSafety,
	listComposeServices,
	parseComposeFile,
} from "../compose/compose-file";
import { createCompose, resyncComposeDomains, updateComposeById } from "../compose/service";
import { queueDeployment } from "../deployment";
import { type DnsRecordOutcome, ensureDnsRecords } from "../dns";
import { badRequest, notFound } from "../errors";
import { assertWithinQuota, findProjectById } from "../projects";
import { findTemplateById, listTemplateSummaries } from "./catalog";
import { resolveTemplateEnv } from "./placeholders";
import { summarizeTemplateServices } from "./services";
import { findSourcedTemplate, listSourcedTemplates } from "./sources";
import type { Template, TemplateSummary } from "./types";

export type { TemplateServiceSummary } from "./services";
export type {
	SourcedTemplate,
	SyncTemplateSourceResult,
	TemplateSourceRow,
} from "./sources";
export {
	assertTemplateSourceUrl,
	findSourcedTemplate,
	findTemplateSource,
	listSourcedTemplates,
	listTemplateSources,
	parseRemoteTemplateId,
	readTemplateSourceReport,
	remoteTemplateId,
	removeTemplateSourceCache,
	syncTemplateSource,
} from "./sources";
export type { Template, TemplateEnvVar, TemplateSummary } from "./types";
export { findTemplateById, listTemplateSummaries, summarizeTemplateServices };

/** A gallery entry; `source` is set only for entries from a template source. */
export type TemplateSummaryWithSource = TemplateSummary & {
	source?: { templateSourceId: string; name: string };
};

/**
 * The catalog one organization sees: the built-in templates plus the cached
 * entries of its enabled template sources (namespaced `<sourceId>/<id>`, with
 * a `source` badge). Nothing is fetched here — the read path only reads the
 * caches `template.sourcesSync` wrote.
 *
 * `organizationId` is nullable so the router keeps ONE return type: a caller
 * belonging to no organization simply gets the built-in catalog.
 */
export async function listTemplateSummariesForOrg(
	organizationId: string | null,
): Promise<TemplateSummaryWithSource[]> {
	const sourced = organizationId ? await listSourcedTemplates(organizationId) : [];
	return [
		...listTemplateSummaries(),
		...sourced.map(({ compose: _compose, ...summary }) => summary),
	];
}

/** Resolve a template id against the built-in catalog first, then the org's sources. */
export async function findTemplateForOrg(
	organizationId: string | null,
	templateId: string,
): Promise<Template | undefined> {
	const builtIn = findTemplateById(templateId);
	if (builtIn || !organizationId) return builtIn;
	return (await findSourcedTemplate(organizationId, templateId)) ?? undefined;
}

export interface TemplateDomainInput {
	host: string;
	serviceName: string;
	port: number;
}

export interface DeployTemplateInput {
	templateId: string;
	projectId: string;
	environmentName: string;
	/** Caller-provided env values; schema defaults fill in the rest. */
	envValues?: Record<string, string>;
	domains?: TemplateDomainInput[];
}

export interface DeployTemplateResult {
	composeId: string;
	appName: string;
	deploymentId: string;
	/** What the linked DNS provider did for each requested host (`modules/dns`). */
	dns: DnsRecordOutcome[];
}

/**
 * Instantiate a template: create a raw compose service whose compose file
 * keeps the template's `${VAR}` placeholders and whose `.env` carries the
 * resolved values (provided values over schema defaults), optionally attach
 * domains, then enqueue the first deployment.
 *
 * Host-privileged templates (Docker socket / elevated caps) must only be
 * called after the router has asserted instance admin.
 */
export async function deployTemplate(
	organizationId: string,
	input: DeployTemplateInput,
): Promise<DeployTemplateResult> {
	const template = await findTemplateForOrg(organizationId, input.templateId);
	if (!template) {
		throw notFound("Template not found");
	}

	// Org-scope: throws NOT_FOUND/FORBIDDEN when the project is not the caller's.
	await findProjectById(input.projectId, organizationId);
	// Same service quota `compose.create` enforces — templates are not a bypass.
	await assertWithinQuota(organizationId, { services: true });

	const environment = await db.query.environments.findFirst({
		where: and(
			eq(environments.projectId, input.projectId),
			eq(environments.name, input.environmentName),
		),
	});
	if (!environment) {
		throw notFound(`Environment "${input.environmentName}" not found in this project`);
	}

	const safety = template.hostPrivileged ? hostPrivilegedComposeSafety() : undefined;
	// Validate requested domains against the compose services up front so a
	// bad serviceName never leaves a half-configured service behind.
	try {
		assertSafeComposeSpec(parseComposeFile(template.compose), safety);
	} catch (error) {
		throw badRequest(
			error instanceof Error
				? `Template "${template.name}" failed safety checks: ${error.message}`
				: `Template "${template.name}" failed safety checks`,
		);
	}
	const serviceNames = listComposeServices(template.compose);
	for (const domain of input.domains ?? []) {
		if (!serviceNames.includes(domain.serviceName)) {
			throw badRequest(
				`Service "${domain.serviceName}" is not defined by the ${template.name} compose file`,
			);
		}
		try {
			assertTraefikHost(domain.host);
			assertTraefikPath("/");
			assertComposeServiceName(domain.serviceName);
		} catch (error) {
			throw badRequest(error instanceof Error ? error.message : "Invalid domain");
		}
	}

	// Defaults may carry placeholders (`{{generateSecret}}`, the named
	// generators, `{{domain}}`, `{{env:KEY}}` — placeholders.ts); a value the
	// caller provided is taken verbatim. The domain is the one attached to the
	// suggested service, else the first one, so a `BASE_URL={{domain}}`
	// default is right on the first deploy.
	const attachedDomain =
		input.domains?.find((domain) => domain.serviceName === template.suggestedDomain.serviceName)
			?.host ??
		input.domains?.[0]?.host ??
		null;
	const resolved = resolveTemplateEnv(
		template.env.map((entry) => ({
			key: entry.key,
			value: input.envValues?.[entry.key] ?? entry.default,
		})),
		{ domain: attachedDomain },
	);
	const env = template.env
		.map((entry) => {
			const raw = resolved[entry.key] ?? "";
			// The value lands in a dotenv file — keep it single-line.
			return `${entry.key}=${raw.replace(/[\r\n]+/g, " ")}`;
		})
		.join("\n");

	const service = await createCompose({
		name: template.name,
		description: template.description,
		environmentId: environment.environmentId,
		composeType: "docker-compose",
		sourceType: "raw",
		hostPrivileged: Boolean(template.hostPrivileged),
	});

	try {
		await updateComposeById(service.composeId, {
			composeFile: template.compose,
			env,
		});

		if (input.domains && input.domains.length > 0) {
			await db.insert(domains).values(
				input.domains.map((domain) => ({
					host: assertTraefikHost(domain.host),
					path: "/",
					port: domain.port,
					https: false,
					certificateType: "none" as const,
					serviceName: domain.serviceName,
					domainType: "compose" as const,
					uniqueConfigKey: randomBytes(6).toString("hex"),
					composeId: service.composeId,
				})),
			);
			await resyncComposeDomains(service.composeId);
		}
	} catch (error) {
		// Roll back the row so a failed instantiation never leaves an orphan.
		await bestEffort(`roll back compose row ${service.composeId}`, () =>
			db.delete(compose).where(eq(compose.composeId, service.composeId)),
		);
		throw error;
	}

	const deploymentId = await queueDeployment({
		composeId: service.composeId,
		type: "deploy",
	});
	// Point every requested host at this box at the linked DNS provider (a
	// no-op unless the operator switched it on). Best-effort by contract:
	// the stack is deploying either way, and each outcome says what happened.
	const dns = await ensureDnsRecords((input.domains ?? []).map((domain) => domain.host));
	return {
		composeId: service.composeId,
		appName: service.appName,
		deploymentId,
		dns,
	};
}
