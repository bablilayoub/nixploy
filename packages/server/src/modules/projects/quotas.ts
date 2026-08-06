import { TRPCError } from "@trpc/server";
import { count, eq } from "drizzle-orm";
import { db } from "../../db";
import { organizations, projects } from "../../db/schema";
import { getOrganizationServiceStatusCounts } from "./index";

export interface OrgQuotas {
	maxProjects: number | null;
	maxServices: number | null;
	maxCpuShares: number | null;
	maxMemoryMb: number | null;
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

export async function assertWithinQuota(
	organizationId: string,
	checks: { projects?: boolean; services?: boolean },
): Promise<void> {
	const quotas = await getOrgQuotas(organizationId);

	if (checks.projects && quotas.maxProjects != null) {
		const [row] = await db
			.select({ value: count() })
			.from(projects)
			.where(eq(projects.organizationId, organizationId));
		if ((row?.value ?? 0) >= quotas.maxProjects) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Project limit reached (${quotas.maxProjects} max)`,
			});
		}
	}

	if (checks.services && quotas.maxServices != null) {
		const serviceCounts = await getOrganizationServiceStatusCounts(organizationId);
		if (serviceCounts.total >= quotas.maxServices) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Service limit reached (${quotas.maxServices} max)`,
			});
		}
	}
}
