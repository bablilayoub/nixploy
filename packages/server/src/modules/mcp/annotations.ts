/**
 * Behaviour hints attached to every MCP tool.
 *
 * An agent reads these before it decides whether to call a tool without asking,
 * and a host uses them to decide what to put a confirmation dialog in front of.
 * Which means a wrong hint is worse than no hint: `readOnlyHint: true` on
 * something that mutates is how an agent deletes a domain while "just looking
 * around". They are therefore declared here, one line per tool, rather than
 * inferred from the tool's name — and a test fails the build when a tool ships
 * without an entry.
 *
 * `openWorldHint` is deliberately left unset everywhere. Its default is `true`
 * ("may interact with external entities"), which is the honest answer for a
 * PaaS: a deploy clones from a git host and pulls from a registry, and even a
 * read reaches a Docker daemon. Claiming a closed world would be a smaller
 * promise than this surface can keep.
 */
export interface McpToolAnnotations {
	/** Human title a host shows instead of the snake_case name. */
	title: string;
	/** True only when the tool cannot change anything. */
	readOnlyHint: boolean;
	/**
	 * True when calling it may take something away or interrupt service —
	 * what a host should confirm. Broader than "deletes rows": stopping a
	 * production service is not destructive to data and is still not something
	 * an agent should do unprompted.
	 */
	destructiveHint: boolean;
	/** True when calling it twice with the same arguments changes nothing more. */
	idempotentHint: boolean;
}

const read = (title: string): McpToolAnnotations => ({
	title,
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
});

/** Changes something, but neither takes anything away nor interrupts service. */
const write = (title: string, idempotent: boolean): McpToolAnnotations => ({
	title,
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: idempotent,
});

/** Worth a confirmation: it interrupts service, or it removes something. */
const dangerous = (title: string, idempotent: boolean): McpToolAnnotations => ({
	title,
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: idempotent,
});

export const MCP_TOOL_ANNOTATIONS: Record<string, McpToolAnnotations> = {
	// ── reads ────────────────────────────────────────────────────────────────
	list_projects: read("List projects"),
	list_services: read("List services"),
	get_service_logs: read("Read service logs"),
	list_deployments: read("List deployments"),
	list_domains: read("List domains"),
	get_service_metrics: read("Read service metrics"),
	list_templates: read("List templates"),
	list_databases: read("List databases"),
	get_database: read("Read a database"),
	get_env: read("Read environment variables"),
	get_resolved_env: read("Read resolved environment"),
	list_incidents: read("List incidents"),
	list_backups: read("List backup schedules"),
	list_backup_runs: read("List backup runs"),
	list_previews: read("List preview deployments"),
	get_deployment_provenance: read("Read deployment provenance"),
	get_platform_health: read("Read platform health"),
	list_rollback_points: read("List rollback points"),
	get_service_events: read("Read a service's event timeline"),
	get_service_runtime_summary: read("Summarise a service's runtime"),
	explain_last_failure: read("Explain the last failed deploy"),

	// ── writes ───────────────────────────────────────────────────────────────
	// A deploy is not idempotent: calling it twice queues two builds.
	deploy_service: write("Deploy an application", false),
	deploy_compose: write("Deploy a compose stack", false),
	deploy_and_wait: write("Deploy and wait for the result", false),
	restart_service: write("Restart a service", false),
	start_service: write("Start a service", true),
	add_domain: write("Attach a domain", false),
	set_env: write("Set environment variables", true),
	run_backup: write("Run a backup now", false),
	verify_backup: write("Verify a backup", false),
	acknowledge_incident: write("Acknowledge an incident", true),
	resolve_incident: write("Resolve an incident", true),

	// ── worth confirming ─────────────────────────────────────────────────────
	// Reversible and data-preserving, but it takes the service offline — which
	// is exactly the class of action a host should put a dialog in front of.
	stop_service: dangerous("Stop a service", true),
	remove_domain: dangerous("Remove a domain", true),
	rollback_deployment: dangerous("Roll back to an earlier image", false),
	cancel_deployment: dangerous("Cancel a running deployment", true),
};
