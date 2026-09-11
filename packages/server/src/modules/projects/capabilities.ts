import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { members } from "../../db/schema";
import { forbidden } from "../errors";
import { ORG_ROLE_RANK, type OrgRole } from "./roles";

/**
 * Capability catalog — fixed vocabulary for org-scoped authorization.
 * Groups drive the Members UI; ids are stable (stored in capability_overrides).
 *
 * `minRole` marks capabilities that reach the shared host or the organization
 * itself: they can never be handed to a lower-ranked member through a
 * capability overlay (`organization.setMemberCapabilities`), only earned by
 * the role. Capabilities without `minRole` are freely delegable within the
 * granter's own set.
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
		minRole: "admin",
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
		minRole: "admin",
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
		minRole: "admin",
	},
	{
		id: "settings.manage",
		group: "Organization",
		label: "Organization settings",
		description: "Change org name, quotas, branding, and server AI settings.",
		minRole: "admin",
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

/**
 * Minimum org role a capability may be delegated to, or `null` when the
 * capability carries no rank floor. Enforced by
 * `organization.setMemberCapabilities` for both `grant` and `revoke`.
 */
export function capabilityMinRole(id: OrgCapability): OrgRole | null {
	const entry = CAPABILITY_CATALOG.find((item) => item.id === id) as
		| { minRole?: OrgRole }
		| undefined;
	return entry?.minRole ?? null;
}

/** Capabilities that may not be granted below their `minRole`. */
export const RANK_BOUND_CAPABILITIES = CAPABILITY_CATALOG.filter(
	(entry): entry is (typeof CAPABILITY_CATALOG)[number] & { minRole: OrgRole } =>
		"minRole" in entry,
).map((entry) => entry.id) as OrgCapability[];

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

// ── per-request capability scope (API keys) ─────────────────────────────────
//
// An API-key caller is not the owner: the key's scope (and the org it is bound
// to) reduce what `assertCapability` / `hasCapability` may see for the duration
// of one request. `assertCapability(userId, orgId, cap)` is called from ~100
// places with no request handle, so the overlay travels in an
// AsyncLocalStorage store that `buildApiKeyContext` enters once per request.
// Cookie sessions never enter it and behave exactly as before.

export interface CapabilityScope {
	/** Capability ceiling — the member's own set is intersected with this. */
	allowed: ReadonlySet<OrgCapability>;
	/** When set, no capability resolves outside this organization. */
	organizationId?: string | null;
	/** Human-readable source, for error messages ("API key scope: read"). */
	label?: string;
}

const capabilityScopeStorage = new AsyncLocalStorage<CapabilityScope>();

/** The scope in force for the current request, if any. */
export function currentCapabilityScope(): CapabilityScope | undefined {
	return capabilityScopeStorage.getStore();
}

/**
 * Run `fn` with a capability ceiling in force.
 *
 * `buildApiKeyContext` cannot install the scope itself (`enterWith` from an
 * async callee does not reach the awaiting caller once Node switches to the
 * async-context-frame implementation), so it *carries* the scope on the tRPC
 * context and `protectedProcedure` enters it around the procedure. Non-tRPC
 * key callers (the deploy webhook) wrap their own work with this directly.
 */
export function runWithCapabilityScope<T>(scope: CapabilityScope, fn: () => T): T {
	return capabilityScopeStorage.run(scope, fn);
}

/** Intersect a resolved capability set with the request scope, if any. */
function applyCapabilityScope(
	capabilities: OrgCapability[],
	organizationId: string,
): OrgCapability[] {
	const scope = capabilityScopeStorage.getStore();
	if (!scope) return capabilities;
	if (scope.organizationId && scope.organizationId !== organizationId) return [];
	return capabilities.filter((capability) => scope.allowed.has(capability));
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
	const capabilities = applyCapabilityScope(
		[...effectiveCapabilities(membership.role, overrides)].sort() as OrgCapability[],
		organizationId,
	);
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
		const scope = currentCapabilityScope();
		if (scope?.label) {
			throw forbidden(
				`This action requires the "${capability}" capability, outside this ${scope.label}`,
			);
		}
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
