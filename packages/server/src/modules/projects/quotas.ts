import { count, eq } from "drizzle-orm";
import { db } from "../../db";
import { organizations, projects } from "../../db/schema";
import { badRequest } from "../errors";
import { getOrganizationServiceStatusCounts } from "./index";

export interface OrgQuotas {
	maxProjects: number | null;
	maxServices: number | null;
	maxCpuShares: number | null;
	maxMemoryMb: number | null;
	/**
	 * Runtime log history kept per service of this org, in days — capped by
	 * the instance's `NIXPLOY_RUNTIME_LOG_RETENTION_DAYS`; null = the
	 * instance value (`modules/runtime-logs/retention.ts`).
	 */
	runtimeLogRetentionDays: number | null;
	/** Same, in megabytes per service (`NIXPLOY_RUNTIME_LOG_MAX_MB_PER_SERVICE`). */
	runtimeLogMaxMbPerService: number | null;
}

export interface OrgBranding {
	displayName: string | null;
	accentColor: string | null;
}

export interface OrgMetadata {
	quotas?: Partial<OrgQuotas>;
	branding?: Partial<OrgBranding>;
}

const defaultQuotas = (): OrgQuotas => ({
	maxProjects: null,
	maxServices: null,
	maxCpuShares: null,
	maxMemoryMb: null,
	runtimeLogRetentionDays: null,
	runtimeLogMaxMbPerService: null,
});

export function parseOrgMetadata(raw: string | null | undefined): OrgMetadata {
	if (!raw) return {};
	try {
		return JSON.parse(raw) as OrgMetadata;
	} catch {
		return {};
	}
}

export function serializeOrgMetadata(metadata: OrgMetadata): string {
	return JSON.stringify(metadata);
}

export async function getOrgQuotas(organizationId: string): Promise<OrgQuotas> {
	const org = await db.query.organizations.findFirst({
		where: eq(organizations.id, organizationId),
		columns: { metadata: true },
	});
	const parsed = parseOrgMetadata(org?.metadata);
	return { ...defaultQuotas(), ...parsed.quotas };
}

/** Docker CPU shares per core — 1024 shares == 1 CPU, the engine's own unit. */
const CPU_SHARES_PER_CORE = 1024;

/** Never hand a workload less than 0.05 CPU: it would never finish booting. */
const MIN_NANO_CPUS = 50_000_000;

/**
 * Per-service resource ceiling derived from the org quota, in the units the
 * swarm spec wants. Applied as `Resources.Limits` **only where the service
 * itself sets none** — an explicit per-service limit always wins.
 */
export interface QuotaResourceDefaults {
	memoryBytes?: number;
	nanoCpus?: number;
}

/**
 * `maxMemoryMb` / `maxCpuShares` from the org metadata as swarm limits.
 * `maxCpuShares` is read as Docker CPU shares (1024 = one core), so
 * `2048` means "two cores per service".
 */
export async function getQuotaResourceDefaults(
	organizationId: string,
): Promise<QuotaResourceDefaults> {
	const quotas = await getOrgQuotas(organizationId);
	const defaults: QuotaResourceDefaults = {};
	if (quotas.maxMemoryMb != null && quotas.maxMemoryMb > 0) {
		defaults.memoryBytes = Math.floor(quotas.maxMemoryMb) * 1024 * 1024;
	}
	if (quotas.maxCpuShares != null && quotas.maxCpuShares > 0) {
		defaults.nanoCpus = Math.max(
			MIN_NANO_CPUS,
			Math.floor((quotas.maxCpuShares / CPU_SHARES_PER_CORE) * 1e9),
		);
	}
	return defaults;
}

export async function getOrgBranding(organizationId: string): Promise<OrgBranding> {
	const org = await db.query.organizations.findFirst({
		where: eq(organizations.id, organizationId),
		columns: { metadata: true, name: true },
	});
	const parsed = parseOrgMetadata(org?.metadata);
	return {
		displayName: parsed.branding?.displayName ?? org?.name ?? null,
		accentColor: parsed.branding?.accentColor ?? null,
	};
}

/**
 * Reject a create when it would exceed the org's quotas. `services` may be a
 * count for bulk creates (environment clone, template deploy): the check is
 * `existing + adding > max`, so `true` means "one more service".
 */
export async function assertWithinQuota(
	organizationId: string,
	checks: { projects?: boolean; services?: boolean | number },
): Promise<void> {
	const quotas = await getOrgQuotas(organizationId);

	if (checks.projects && quotas.maxProjects != null) {
		// Deliberately NOT project-filtered: a quota is a property of the
		// organization, and counting only what the caller can see would let a
		// teams-scoped member create past the limit.
		const [row] = await db
			.select({ value: count() })
			.from(projects)
			.where(eq(projects.organizationId, organizationId));
		if ((row?.value ?? 0) >= quotas.maxProjects) {
			throw badRequest(`Project limit reached (${quotas.maxProjects} max)`);
		}
	}

	const adding = typeof checks.services === "number" ? checks.services : checks.services ? 1 : 0;
	if (adding > 0 && quotas.maxServices != null) {
		const serviceCounts = await getOrganizationServiceStatusCounts(organizationId);
		if (serviceCounts.total + adding > quotas.maxServices) {
			throw badRequest(`Service limit reached (${quotas.maxServices} max)`);
		}
	}
}
