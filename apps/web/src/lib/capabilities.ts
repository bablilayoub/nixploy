/**
 * Human-readable labels for the org capability catalog
 * (packages/server/src/modules/projects/capabilities.ts). Used to explain
 * disabled controls — the server remains the authority on every mutation.
 */
const CAPABILITY_LABELS: Record<string, string> = {
	"project.write": "Create & edit projects",
	"project.delete": "Delete projects & environments",
	"service.create": "Create services",
	"service.write": "Edit service settings",
	"service.delete": "Delete services",
	"service.deploy": "Deploy & redeploy",
	"service.runtime": "Start & stop",
	"tags.manage": "Manage tags",
	"templates.deploy": "Deploy templates",
	"secrets.read": "View secrets",
	"secrets.write": "Edit secrets",
	"domains.manage": "Manage domains",
	"backups.manage": "Manage backups",
	"schedules.manage": "Manage schedules",
	"gitops.manage": "Manage GitOps",
	"ai.use": "Use AI Copilot",
	"servers.manage": "Manage servers",
	"registries.manage": "Manage registries",
	"destinations.manage": "Manage backup storage",
	"certificates.manage": "Manage certificates",
	"ssh_keys.manage": "Manage SSH keys",
	"git_providers.manage": "Manage git providers",
	"docker.manage": "Docker control center",
	"notifications.manage": "Manage notifications",
	"members.manage": "Manage members",
	"settings.manage": "Organization settings",
	"audit.read": "View audit log",
};

export function capabilityLabel(capability: string): string {
	return CAPABILITY_LABELS[capability] ?? capability;
}

/** Tooltip / `title` text for a control the caller lacks the capability for. */
export function missingCapabilityHint(capability: string): string {
	return `Requires the "${capabilityLabel(capability)}" permission — ask an organization admin`;
}

export const INSTANCE_ADMIN_HINT = "Only the instance admin can do this";

/** True when the better-auth org role string includes admin or owner. */
export function isOrgAdminRole(role: string | null | undefined): boolean {
	if (!role) return false;
	return role
		.split(",")
		.map((part) => part.trim())
		.some((part) => part === "admin" || part === "owner");
}
