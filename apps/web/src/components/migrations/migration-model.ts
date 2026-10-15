import type { ImportPlan } from "@nixploy/server/modules/import/index";

/** Planning output is already redacted by the API. Build tasks from facts, never a readiness score. */
export function migrationTasks(plan: ImportPlan) {
	const tasks: Array<{ title: string; detail: string; href?: string }> = [];
	const notes = plan.notes.map((note) => note.message).join(" ");
	const envKeys = [
		...(plan.manifest.project.envKeys ?? []),
		...(plan.manifest.environment?.envKeys ?? []),
		...(plan.manifest.applications ?? []).flatMap((row) => row.envKeys ?? []),
		...(plan.manifest.compose ?? []).flatMap((row) => row.envKeys ?? []),
	];
	if (envKeys.length || /env|credential|password|secret|encrypted/i.test(notes)) {
		tasks.push({
			title: "Review secrets and connection strings",
			detail: `${new Set(envKeys).size} visible environment keys. Readable source values are copied; encrypted values are omitted. Replace source credentials and database URLs before deployment.`,
		});
	}
	if (plan.counts.databases) {
		tasks.push({
			title: "Restore database data",
			detail: `${plan.counts.databases} database configuration(s) selected. Target passwords are generated here; restore a source backup and update dependent services. Import copies no database data.`,
			href: "/dashboard/settings/destinations",
		});
	}
	if (
		/mount|volume|storage|file/i.test(notes) ||
		(plan.manifest.applications ?? []).some((row) => row.mounts?.length)
	) {
		tasks.push({
			title: "Restore persistent storage",
			detail:
				"Check every volume and bind/file mount named in the notes. Copy data to the intended target and verify ownership before starting the service.",
		});
	}
	tasks.push({
		title: "Confirm server and registry access",
		detail:
			"Check the target server on each service and reconnect private Git providers or registries. An unmatched source server uses the primary target.",
		href: "/dashboard/settings/servers",
	});
	if (plan.counts.domains) {
		tasks.push({
			title: "Verify routing before switching DNS",
			detail: `${plan.counts.domains} domain configuration(s). After deploying, use each domain's diagnosis to check its port, route and TLS; switch traffic only after validation.`,
		});
	}
	tasks.push({
		title: "Deploy and check the target services",
		detail:
			"Open each service, review configuration, then explicitly deploy or start it. Check logs and health before retiring the source.",
	});
	return tasks;
}

export function importBlockers(plan: ImportPlan, can: (capability: string) => boolean) {
	const required = ["gitops.manage", "secrets.write"];
	if (plan.target.createsProject || plan.target.createsEnvironment) required.push("project.write");
	if (!plan.plan || plan.plan.items.some((row) => row.action === "create" && !row.parent))
		required.push("service.create");
	if (
		plan.plan?.items.some((row) => row.action !== "noop" && (row.parent || row.action !== "create"))
	)
		required.push("service.write");
	return required.filter((capability) => !can(capability));
}
