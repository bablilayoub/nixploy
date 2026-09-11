import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { forbidden } from "../errors";
import { ORG_ROLE_RANK, type OrgRole } from "./roles";

/**
 * Capability catalog — fixed vocabulary for org-scoped authorization.
 * Groups drive the Members UI; ids are stable (stored in capability_overrides).
 */
export const CAPABILITY_CATALOG = [
	// Projects & services
	{
		id: "project.write",
		group: "Projects",
		label: "Create & edit projects",
		description: "Create projects and environments; rename and describe them.",
	},
	{
		id: "project.delete",
		group: "Projects",
		label: "Delete projects & environments",
		description: "Permanently delete projects or environments and their services.",
	},
	{
		id: "service.create",
		group: "Services",
		label: "Create services",
		description: "Add applications, compose stacks, and databases.",
	},
	{
		id: "service.write",
		group: "Services",
		label: "Edit service settings",
		description: "Update source, build, ports, mounts, redirects, and general settings.",
	},
	{
		id: "service.delete",
		group: "Services",
		label: "Delete services",
		description: "Remove applications, compose stacks, and databases.",
	},
	{
		id: "service.deploy",
		group: "Services",
		label: "Deploy & redeploy",
		description: "Queue builds and rollouts, cancel deployments, roll back.",
	},
	{
		id: "service.runtime",
		group: "Services",
		label: "Start & stop",
		description: "Start, stop, and reload running services without a full rebuild.",
	},
	{
		id: "tags.manage",
		group: "Services",
		label: "Manage tags",
		description: "Create organization tags and assign them to services.",
	},
	{
		id: "templates.deploy",
		group: "Services",
		label: "Deploy templates",
		description: "Instantiate catalog templates into a project environment.",
	},
	// Secrets & networking
	{
		id: "secrets.read",
		group: "Secrets & domains",
		label: "View secrets",
		description: "See environment variable values (not only keys).",
	},
	{
		id: "secrets.write",
		group: "Secrets & domains",
		label: "Edit secrets",
		description: "Create and update environment variables on projects and services.",
	},
	{
		id: "domains.manage",
		group: "Secrets & domains",
		label: "Manage domains",
		description: "Attach, update, and remove Traefik domains and HTTPS settings.",
	},
	// Data protection & automation
	{
		id: "backups.manage",
		group: "Automation",
		label: "Manage backups",
		description: "Configure database and volume backups; run and restore them.",
	},
	{
		id: "schedules.manage",
		group: "Automation",
		label: "Manage schedules",
		description: "Create cron schedules for deploys and maintenance jobs.",
	},
	{
		id: "gitops.manage",
		group: "Automation",
		label: "Manage GitOps",
		description: "Configure GitOps sync URLs and export project manifests.",
	},
	{
		id: "ai.use",
		group: "Automation",
		label: "Use AI Copilot",
		description: "Chat, explain failed deploys, and generate compose drafts.",
	},
	// Infrastructure
	{
		id: "servers.manage",
		group: "Infrastructure",
		label: "Manage servers",
		description: "Add, test, and remove remote Docker Swarm nodes.",
	},
	{
		id: "registries.manage",
		group: "Infrastructure",
		label: "Manage registries",
		description: "Configure private container registries and credentials.",
	},
	{
		id: "destinations.manage",
		group: "Infrastructure",
		label: "Manage backup storage",
		description: "Configure S3-compatible backup storage destinations.",
	},
	{
		id: "certificates.manage",
		group: "Infrastructure",
		label: "Manage certificates",
		description: "Upload and delete custom TLS certificates.",
	},
	{
		id: "ssh_keys.manage",
		group: "Infrastructure",
		label: "Manage SSH keys",
		description: "Create and delete SSH keys used for git and servers.",
	},
	{
		id: "git_providers.manage",
		group: "Infrastructure",
		label: "Manage git providers",
		description: "Connect GitHub, GitLab, Gitea, and Bitbucket apps.",
	},
	{
		id: "docker.manage",
		group: "Infrastructure",
		label: "Docker control center",
		description: "Inspect and mutate host containers, images, volumes, and Swarm.",
	},
	{
		id: "notifications.manage",
		group: "Infrastructure",
		label: "Manage notifications",
		description: "Configure Slack, Discord, email, and webhook channels.",
	},
	// Organization
	{
		id: "members.manage",
		group: "Organization",
		label: "Manage members",
		description: "Invite members and edit per-member capability overlays.",
	},
	{
		id: "settings.manage",
		group: "Organization",
		label: "Organization settings",
		description: "Change org name, quotas, branding, and server AI settings.",
	},
	{
		id: "audit.read",
		group: "Organization",
		label: "View audit log",
		description: "Read organization activity and audit events.",
	},
] as const;

export type OrgCapability = (typeof CAPABILITY_CATALOG)[number]["id"];

export const ORG_CAPABILITIES = CAPABILITY_CATALOG.map((entry) => entry.id) as unknown as [
	OrgCapability,
	...OrgCapability[],
];

export const capabilitySchemaValues = ORG_CAPABILITIES;

export type CapabilityGroup = (typeof CAPABILITY_CATALOG)[number]["group"];

const CAP_SET = new Set<string>(ORG_CAPABILITIES);

export function isOrgCapability(value: string): value is OrgCapability {
	return CAP_SET.has(value);
}

export function capabilityMeta(id: OrgCapability) {
	const entry = CAPABILITY_CATALOG.find((item) => item.id === id);
	if (!entry) {
		throw new Error(`Unknown capability: ${id}`);
	}
	return entry;
}

/** Baseline capabilities implied by each org role (before member overrides). */
export const ROLE_CAPABILITIES: Record<OrgRole, readonly OrgCapability[]> = {
	viewer: ["audit.read"],
	member: [
		"project.write",
		"service.create",
		"service.write",
		"secrets.read",
		"secrets.write",
		"domains.manage",
		"tags.manage",
		"ai.use",
		"audit.read",
	],
	deployer: [
		"project.write",
		"service.create",
		"service.write",
		"service.deploy",
		"service.runtime",
		"secrets.read",
		"secrets.write",
		"domains.manage",
		"tags.manage",
		"templates.deploy",
		"backups.manage",
		"schedules.manage",
		"ai.use",
		"audit.read",
	],
	admin: ORG_CAPABILITIES,
	owner: ORG_CAPABILITIES,
};

export type CapabilityOverrides = {
	grant?: OrgCapability[];
	revoke?: OrgCapability[];
};

export function parseCapabilityOverrides(raw: unknown): CapabilityOverrides {
	if (!raw || typeof raw !== "object") return {};
	const record = raw as Record<string, unknown>;
	const grant = Array.isArray(record.grant)
		? record.grant.filter(
				(item): item is OrgCapability => typeof item === "string" && isOrgCapability(item),
			)
		: undefined;
	const revoke = Array.isArray(record.revoke)
		? record.revoke.filter(
				(item): item is OrgCapability => typeof item === "string" && isOrgCapability(item),
			)
		: undefined;
	return { grant, revoke };
}

/** Highest-ranked known role segment (mirrors orgRoleRank matching). */
export function primaryOrgRole(role: string): OrgRole {
	const parts = role
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	let best: OrgRole = "viewer";
	for (const part of parts) {
		if (part in ORG_ROLE_RANK && ORG_ROLE_RANK[part as OrgRole] > ORG_ROLE_RANK[best]) {
			best = part as OrgRole;
		}
	}
	return best;
}

export function roleDefaultCapabilities(role: string): readonly OrgCapability[] {
	return ROLE_CAPABILITIES[primaryOrgRole(role)];
}

export function effectiveCapabilities(
	role: string,
	overrides?: CapabilityOverrides | null,
): Set<OrgCapability> {
	const base = new Set<OrgCapability>(roleDefaultCapabilities(role));
	const parsed = overrides ?? {};
	for (const cap of parsed.grant ?? []) base.add(cap);
	for (const cap of parsed.revoke ?? []) base.delete(cap);
	return base;
}

export async function getMemberCapabilities(
	userId: string,
	organizationId: string,
): Promise<{
	role: string;
	capabilities: OrgCapability[];
	overrides: CapabilityOverrides;
} | null> {
	const membership = await db.query.members.findFirst({
		where: and(eq(members.userId, userId), eq(members.organizationId, organizationId)),
	});
	if (!membership) return null;
	const overrides = parseCapabilityOverrides(membership.capabilityOverrides);
	const capabilities = [
		...effectiveCapabilities(membership.role, overrides),
	].sort() as OrgCapability[];
	return { role: membership.role, capabilities, overrides };
}

export async function hasCapability(
	userId: string,
	organizationId: string,
	capability: OrgCapability,
): Promise<boolean> {
	const info = await getMemberCapabilities(userId, organizationId);
	return Boolean(info?.capabilities.includes(capability));
}

/**
 * Require an effective capability for the caller in `organizationId`.
 * @throws DomainError FORBIDDEN
 */
export async function assertCapability(
	userId: string,
	organizationId: string,
	capability: OrgCapability,
): Promise<void> {
	const ok = await hasCapability(userId, organizationId, capability);
	if (!ok) {
		throw forbidden(`This action requires the "${capability}" capability`);
	}
}

/** Public catalog payload for the Members UI and ⌘K. */
export function publicCapabilityCatalog() {
	return {
		capabilities: CAPABILITY_CATALOG.map((entry) => entry.id),
		catalog: CAPABILITY_CATALOG.map((entry) => ({ ...entry })),
		groups: [...new Set(CAPABILITY_CATALOG.map((entry) => entry.group))],
		roleDefaults: ROLE_CAPABILITIES,
	};
}

/** Re-export role rank for callers that mix role + capability checks. */
export { orgRoleRank } from "./roles";
