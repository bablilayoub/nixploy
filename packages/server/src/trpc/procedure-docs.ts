/**
 * Human documentation for the REST/OpenAPI surface, keyed by
 * `<router>.<procedure>` exactly as it appears at `/api/<router>.<procedure>`.
 *
 * Why a side-table instead of `.meta({ description })` on each procedure:
 * the routers are edited constantly and by many hands, and tRPC `meta` would
 * put prose in the middle of authorization logic. Keeping it here means one
 * file to review when the public API's wording changes, and it lets
 * `openapi.ts` emit summaries, descriptions and the `x-nixploy-capability`
 * extension without importing anything from the routers.
 *
 * Migration note: routers may later adopt `.meta({ summary, description,
 * capability })`. `openapi.ts` already prefers a procedure's own `meta` when
 * one exists, so the move can happen router by router; this map is the
 * fallback (and the source for everything that has not moved).
 *
 * This module must stay dependency-free: `apps/cli` imports it in tests to
 * assert that every CLI command maps to a documented procedure.
 */

export interface ProcedureDoc {
	/** One line, imperative, shown as the OpenAPI operation summary. */
	summary: string;
	/** A sentence or two of behaviour, side effects and gotchas. */
	description: string;
	/**
	 * Capabilities the procedure asserts (`modules/projects/capabilities.ts`).
	 * Emitted as `x-nixploy-capability`; every listed one is required.
	 */
	capability?: readonly string[];
	/** Also requires the instance-admin role (platform-wide, beyond the org). */
	instanceAdmin?: boolean;
}

const SERVICE_LIFECYCLE_NOTE =
	"Runs against the Docker Swarm service; the database row is the source of truth for the target host.";

/** The five database routers are generated from one shape — so are their docs. */
function databaseDocs(router: string, label: string): Record<string, ProcedureDoc> {
	return {
		[`${router}.all`]: {
			summary: `List ${label} services in a project`,
			description: `Every ${label} service of a project, optionally narrowed to one environment. Passwords and env blobs are redacted for callers without secrets.read.`,
		},
		[`${router}.one`]: {
			summary: `Get one ${label} service`,
			description: `Full row for a ${label} service including image, resources and external port. Secrets are nulled (not omitted) for callers without secrets.read.`,
		},
		[`${router}.create`]: {
			summary: `Create a ${label} service`,
			description: `Creates the row and its volume, then starts the container. Credentials are stored encrypted at rest (AES-256-GCM).`,
			capability: ["service.create", "secrets.write"],
		},
		[`${router}.update`]: {
			summary: `Update a ${label} service`,
			description: `Changes image, resources, command or credentials. Changing credentials also requires secrets.write; a restart is needed for most fields to take effect.`,
			capability: ["service.write"],
		},
		[`${router}.duplicate`]: {
			summary: `Duplicate a ${label} service`,
			description: `Copies configuration and env into the same or another environment. The copy starts stopped with a fresh volume.`,
			capability: ["service.write", "secrets.write"],
		},
		[`${router}.move`]: {
			summary: `Move a ${label} service to another environment`,
			description: "Re-parents the row; the running container and its volume are untouched.",
			capability: ["service.write"],
		},
		[`${router}.remove`]: {
			summary: `Delete a ${label} service`,
			description: `Destructive: removes the row, the container and the data volume. Backups already uploaded to a destination are kept.`,
			capability: ["service.delete"],
		},
		[`${router}.start`]: {
			summary: `Start a ${label} service`,
			description: SERVICE_LIFECYCLE_NOTE,
			capability: ["service.deploy"],
		},
		[`${router}.stop`]: {
			summary: `Stop a ${label} service`,
			description: `Scales the service to zero. Data volume and configuration are kept. ${SERVICE_LIFECYCLE_NOTE}`,
			capability: ["service.runtime"],
		},
		[`${router}.reload`]: {
			summary: `Recreate the ${label} container`,
			description: `Re-applies image, env, resources and mounts by recreating the container. ${SERVICE_LIFECYCLE_NOTE}`,
			capability: ["service.runtime"],
		},
		[`${router}.saveEnvironment`]: {
			summary: `Replace the ${label} service env vars`,
			description:
				"Replaces the whole `.env` blob of the service (merge client-side first). Stored encrypted; applied on the next start/reload.",
			capability: ["secrets.write"],
		},
		[`${router}.saveExternalPort`]: {
			summary: `Publish the ${label} service on a host port`,
			description:
				"Publishes (or, with null, unpublishes) the database on a host port. Exposing a database to the internet is a deliberate risk — see docs/hardening.md.",
			capability: ["service.write"],
		},
		[`${router}.getConnectionUrl`]: {
			summary: `Get the ${label} connection URL`,
			description:
				"Returns the connection string with the decrypted password, so it requires secrets.read.",
			capability: ["secrets.read"],
		},
		[`${router}.getStatus`]: {
			summary: `Get ${label} container status`,
			description: "Live container state for the service (running, exited, missing).",
		},
		[`${router}.engineVersions`]: {
			summary: `List curated ${label} versions`,
			description: `The engine versions the picker offers, newest first, with an end-of-life note where one applies. Setting engineVersion on create/update derives the image; a custom dockerImage still overrides it.`,
		},
		[`${router}.listLogicalDatabases`]: {
			summary: `List additional ${label} databases`,
			description: `Extra logical databases created inside this instance, with their owning user. Passwords and connection URLs are nulled for callers without secrets.read. Redis returns an empty list.`,
		},
		[`${router}.createLogicalDatabase`]: {
			summary: `Create an additional ${label} database`,
			description: `Creates a database and an owning user inside the running container (docker exec, SQL over stdin). The password is generated server-side and stored encrypted. The service must be running. Not available for Redis.`,
			capability: ["service.write", "secrets.write"],
		},
		[`${router}.deleteLogicalDatabase`]: {
			summary: `Delete an additional ${label} database`,
			description:
				"Drops the database and its owning user inside the container, then removes the row. Irreversible.",
			capability: ["service.delete"],
		},
	};
}

/** Git provider routers share a shape too (github/gitlab/gitea/bitbucket). */
function gitProviderDocs(router: string, label: string): Record<string, ProcedureDoc> {
	return {
		[`${router}.all`]: {
			summary: `List connected ${label} providers`,
			description: `Every ${label} connection of the organization. Tokens and webhook secrets are never returned.`,
		},
		[`${router}.one`]: {
			summary: `Get one ${label} connection`,
			description: `Connection details without the stored credential.`,
		},
		[`${router}.create`]: {
			summary: `Connect a ${label} provider`,
			description: `Stores the credential encrypted and registers the webhook secret used to authenticate incoming pushes.`,
			capability: ["git_providers.manage"],
		},
		[`${router}.update`]: {
			summary: `Update a ${label} connection`,
			description: "Rotates the credential or changes the host without recreating the connection.",
			capability: ["git_providers.manage"],
		},
		[`${router}.remove`]: {
			summary: `Delete a ${label} connection`,
			description: "Services still pointing at it will fail their next build until re-sourced.",
			capability: ["git_providers.manage"],
		},
		[`${router}.listRepositories`]: {
			summary: `List repositories visible to a ${label} connection`,
			description: "Live call to the provider; results are not cached.",
			capability: ["service.create"],
		},
		[`${router}.listBranches`]: {
			summary: `List branches of a ${label} repository`,
			description: "Live call to the provider; used by the source picker.",
			capability: ["service.create"],
		},
	};
}

const docs: Record<string, ProcedureDoc> = {
	// ───────────────────────────────────────────────────────────── projects
	"project.all": {
		summary: "List projects",
		description:
			"Every project of the caller's organization with its environments and per-environment service counts.",
	},
	"project.one": {
		summary: "Get one project",
		description:
			"A project with its environments and every service inside them. Env blobs are nulled for callers without secrets.read.",
	},
	"project.overview": {
		summary: "Organization counters",
		description:
			"Project count, services grouped by status, and deployments in the last 24 hours. Backs the dashboard header.",
	},
	"project.onboarding": {
		summary: "Onboarding checklist state",
		description:
			"Which of the first-run steps are done — panel domain with TLS, a git provider, a service, a successful deployment, a domain. Backs the dashboard's getting-started card.",
	},
	"project.search": {
		summary: "Search services by name",
		description:
			"Organization-wide fuzzy search across every service kind, annotated with the owning project and environment.",
	},
	"project.create": {
		summary: "Create a project",
		description:
			"Creates the project plus a default `production` environment. Counts against the organization's project quota.",
		capability: ["project.write"],
	},
	"project.update": {
		summary: "Update a project",
		description: "Rename, re-describe, or replace the project-level env blob.",
		capability: ["project.write", "secrets.write"],
	},
	"project.delete": {
		summary: "Delete a project",
		description:
			"Destructive cascade: every environment, service, domain, backup schedule and Traefik route under the project is removed.",
		capability: ["project.delete"],
	},
	"project.saveEnvironment": {
		summary: "Replace the project env vars",
		description:
			"Project-scope `.env` blob, inherited by every environment and service below it. Replace-all: merge client-side first.",
		capability: ["secrets.write"],
	},
	"project.getResolvedEnvironment": {
		summary: "Preview the merged env of an environment",
		description:
			"Organization → project → environment → service merge exactly as the deploy engine computes it, with the origin of each key.",
		capability: ["secrets.read"],
	},

	// ───────────────────────────────────────────────────────── environments
	"environment.byProject": {
		summary: "List environments of a project",
		description: "Environments with per-environment service counts, oldest first.",
	},
	"environment.create": {
		summary: "Create an environment",
		description: "Adds an environment to a project. Names are unique inside the project.",
		capability: ["project.write", "secrets.write"],
	},
	"environment.update": {
		summary: "Update an environment",
		description: "Rename, re-describe, or replace the environment-level env blob.",
		capability: ["project.write", "secrets.write"],
	},
	"environment.duplicate": {
		summary: "Duplicate an environment",
		description: "Copies the environment row and its env blob without copying services.",
		capability: ["project.write", "secrets.write"],
	},
	"environment.clone": {
		summary: "Clone an environment with its services",
		description:
			"Copies every application, compose stack and database into a new environment. The clones start stopped.",
		capability: ["project.write", "secrets.write"],
	},
	"environment.delete": {
		summary: "Delete an environment",
		description: "Destructive cascade: every service in the environment is removed.",
		capability: ["project.delete"],
	},
	"environment.saveEnvironment": {
		summary: "Replace the environment env vars",
		description: "Environment-scope `.env` blob. Replace-all: merge client-side first.",
		capability: ["secrets.write"],
	},

	// ───────────────────────────────────────────────────────── applications
	"application.all": {
		summary: "List applications in a project",
		description:
			"Applications of a project, optionally narrowed to one environment. Secrets are redacted without secrets.read.",
	},
	"application.one": {
		summary: "Get one application",
		description:
			"Full row: source, builder, Swarm options, domains and mounts. Env, build args and credentials are nulled without secrets.read.",
	},
	"application.create": {
		summary: "Create an application",
		description:
			"Creates the row and reserves a unique `appName` (the Swarm service name). Nothing is deployed until `application.deploy`.",
		capability: ["project.write", "service.create"],
	},
	"application.update": {
		summary: "Update application settings",
		description:
			"General settings plus Swarm tuning (replicas, resources, healthcheck, placement, update/rollback config). Takes effect on the next deploy or reload.",
		capability: ["service.write", "secrets.write"],
	},
	"application.duplicate": {
		summary: "Duplicate an application",
		description:
			"Copies configuration, env and build settings into the same or another environment. The copy is not deployed.",
		capability: ["service.write", "secrets.write"],
	},
	"application.move": {
		summary: "Move an application to another environment",
		description: "Re-parents the row. The running Swarm service is untouched.",
		capability: ["service.write"],
	},
	"application.delete": {
		summary: "Delete an application",
		description:
			"Destructive: removes the Swarm service, the Traefik config, the build directory, rollback pins and the row.",
		capability: ["service.delete"],
	},
	"application.deploy": {
		summary: "Queue a build and rollout",
		description:
			"Enqueues a full build (clone/pull → builder → image) followed by a Swarm rollout. Returns immediately with the deployment row; poll `deployment.getLogs`.",
		capability: ["service.deploy"],
	},
	"application.redeployFromDeployment": {
		summary: "Rebuild the commit a past deployment built",
		description:
			"Queues a build of the exact commit recorded on an earlier deployment of the same application. Works after the branch has moved on or been deleted; refuses rows with no resolved commit and preview rows.",
		capability: ["service.deploy"],
	},
	"application.redeploy": {
		summary: "Re-roll the current build",
		description:
			"Re-applies the existing image and configuration without rebuilding the source. Use after changing env vars.",
		capability: ["service.deploy"],
	},
	"application.rollback": {
		summary: "Roll back to a stored image pin",
		description:
			"Re-deploys one of the rollback points kept per application (5 most recent). Does not rebuild.",
		capability: ["service.deploy"],
	},
	"application.cancelDeployment": {
		summary: "Cancel a deployment",
		description:
			"Requests cancellation of a queued or running deployment. A running build is killed; a queued one never starts.",
		capability: ["service.deploy"],
	},
	"application.killBuild": {
		summary: "Kill the running build",
		description:
			"Terminates the build process of the application's current deployment without touching the running service.",
		capability: ["service.deploy"],
	},
	"application.start": {
		summary: "Start an application",
		description: `Scales the Swarm service back to its configured replica count. ${SERVICE_LIFECYCLE_NOTE}`,
		capability: ["service.runtime"],
	},
	"application.stop": {
		summary: "Stop an application",
		description: `Scales the Swarm service to zero. Image, configuration and volumes are kept. ${SERVICE_LIFECYCLE_NOTE}`,
		capability: ["service.runtime"],
	},
	"application.reload": {
		summary: "Restart an application",
		description: "Force-restarts every task of the Swarm service without rebuilding the image.",
		capability: ["service.runtime"],
	},
	"application.saveEnvironment": {
		summary: "Replace the application env vars",
		description:
			"Service-scope `.env` blob plus build args. Replace-all: merge client-side first. Applied on the next deploy or redeploy.",
		capability: ["secrets.write"],
	},
	"application.saveBuildType": {
		summary: "Choose the builder",
		description:
			"nixpacks, railpack, Dockerfile, static or buildpacks, with the builder-specific fields (Dockerfile path, context, target stage, publish directory, cache).",
		capability: ["service.write"],
	},
	"application.saveSource": {
		summary: "Set the application source",
		description:
			"Docker image, plain git remote, connected git provider, or drop-zip. `sourceType` is the discriminator; the fields of the other source kinds are ignored.",
		capability: ["service.write", "secrets.write"],
	},

	// ────────────────────────────────────────────────────────────── compose
	"compose.all": {
		summary: "List compose services in a project",
		description: "Compose stacks of a project, optionally narrowed to one environment.",
	},
	"compose.one": {
		summary: "Get one compose service",
		description:
			"Full row including the compose file and env blob (both nulled without secrets.read).",
	},
	"compose.create": {
		summary: "Create a compose service",
		description:
			"Creates the row with a raw or git-backed compose source. Nothing is deployed until `compose.deploy`.",
		capability: ["service.create"],
	},
	"compose.update": {
		summary: "Update a compose service",
		description:
			"Source, compose path, isolation suffix, auto-deploy, watch paths and build-from-source settings. Isolated deployments rename every service in the rendered file; enabling buildEnabled lets the stack use build: blocks, which Nixploy builds and rewrites to image: before deploying, and publishPorts (instance admin) lets it bind host ports that bypass Traefik.",
		capability: ["service.write"],
		instanceAdmin: true,
	},
	"compose.duplicate": {
		summary: "Duplicate a compose service",
		description: "Copies the compose file, env and settings into the same or another environment.",
		capability: ["service.write", "secrets.write"],
	},
	"compose.move": {
		summary: "Move a compose service to another environment",
		description: "Re-parents the row; the running stack is untouched.",
		capability: ["service.write"],
	},
	"compose.delete": {
		summary: "Delete a compose service",
		description:
			"Destructive: tears the stack down (`docker compose down` / `stack rm`), removes the Traefik config and the row.",
		capability: ["service.delete"],
	},
	"compose.deploy": {
		summary: "Deploy a compose stack",
		description:
			"Renders every `$VAR` from the merged env, runs the safety checks on raw and rendered specs, then applies the stack. Docker runs with an empty process env by design.",
		capability: ["service.deploy"],
	},
	"compose.redeploy": {
		summary: "Redeploy a compose stack",
		description: "Re-pulls the source (git-backed) and re-applies the stack.",
		capability: ["service.deploy"],
	},
	"compose.start": {
		summary: "Start a compose stack",
		description: "Starts the previously created containers without re-rendering the file.",
		capability: ["service.runtime"],
	},
	"compose.stop": {
		summary: "Stop a compose stack",
		description: "Stops every container of the stack; volumes and networks are kept.",
		capability: ["service.runtime"],
	},
	"compose.saveComposeFile": {
		summary: "Replace the compose file",
		description:
			"Stores the YAML after validating it. Rendering and the safety checks run again at deploy time.",
		capability: ["service.write"],
		instanceAdmin: true,
	},
	"compose.saveEnvironment": {
		summary: "Replace the compose service env vars",
		description:
			"The `.env` blob used to render `$VAR` placeholders and passed to the stack. Replace-all.",
		capability: ["secrets.write"],
	},
	"compose.loadServices": {
		summary: "List service names in the compose file",
		description: "Parses the current compose file and returns its service keys (domain targeting).",
	},
	"compose.containers": {
		summary: "List running containers of a stack",
		description: "Live container list for terminal and log targeting, local host or remote server.",
	},
	"compose.rollbackTargets": {
		summary: "List compose rollback points",
		description:
			"Snapshots of the compose file and env each successful deployment rendered, newest first (10 kept). A stack has no single image, so this — not `rollback.all` — is the compose rollback list.",
	},
	"compose.rollback": {
		summary: "Roll a compose stack back to a snapshot",
		description:
			"Restores the compose body and the service-level env of the chosen deployment, then enqueues a normal deployment for them. Git-backed rows keep reading the file from their repository, so only the env is restored — `restoredComposeFile` says which happened.",
		capability: ["service.deploy", "secrets.write"],
	},
	"compose.createFromUrl": {
		summary: "Create a compose service from a URL",
		description:
			"Fetches a compose file over http(s) through the egress guard (no redirects followed, body capped) and stores it after the usual safety checks. Nothing is deployed until `compose.deploy`.",
		capability: ["service.create"],
	},

	// ────────────────────────────────────────────────────────── deployments
	"deployment.byApplication": {
		summary: "List deployments of an application",
		description: "Newest first, cursor-paginated, with status, timings and error message.",
	},
	"deployment.byCompose": {
		summary: "List deployments of a compose service",
		description: "Newest first, cursor-paginated.",
	},
	"deployment.byProject": {
		summary: "List deployments of a project",
		description: "Every service of the project, newest first, cursor-paginated.",
	},
	"deployment.recent": {
		summary: "List recent deployments",
		description: "Organization-wide activity feed, newest first.",
	},
	"deployment.daily": {
		summary: "Daily deployment counts",
		description: "Success/failure counts per day for the requested window (dashboard chart).",
	},
	"deployment.statsByProject": {
		summary: "Deployment statistics for a project",
		description: "Totals, success rate and average duration for the project.",
	},
	"deployment.wait": {
		summary: "Wait for a deployment and read its outcome",
		description:
			"Status, the step it failed in, the tail of the build log, the URLs it should answer on, and Swarm's live task counts. `waitMs` (up to 55000) long-polls until the deployment finishes; `0` returns immediately.",
	},
	"deployment.getLogs": {
		summary: "Read a deployment log",
		description:
			"Byte-offset log reader: pass `offset` from the previous call to stream. Accepts a deploymentId, or an applicationId/composeId to read the latest deployment. `done` turns true when the worker finalizes the row.",
	},
	"rollback.all": {
		summary: "List rollback points of an application",
		description: "Image pins kept after successful deploys (5 most recent), newest first.",
	},
	"rollback.one": {
		summary: "Get one rollback point",
		description: "Image reference and build context of a stored rollback pin.",
	},
	"rollback.delete": {
		summary: "Delete a rollback point",
		description: "Removes the pin. The image itself stays in the local Docker image store.",
		capability: ["service.deploy"],
	},

	// ───────────────────────────────────────────────── preview deployments
	"previewDeployment.list": {
		summary: "List pull-request previews",
		description:
			"Previews of one application or one compose service (exactly one id) with PR metadata, commit, status and expiry.",
	},
	"previewDeployment.byApplication": {
		summary: "List an application's pull-request previews",
		description:
			"Previews of one application with PR metadata, status and expiry. `previewDeployment.list` covers compose services too.",
	},
	"previewDeployment.one": {
		summary: "Get one preview deployment",
		description: "Full preview row including its generated domain(s) and expiry.",
	},
	"previewDeployment.create": {
		summary: "Create a preview deployment",
		description:
			"Creates (or redeploys) a preview for a pull request on an application or a compose service (exactly one id). Fork PRs land in `awaiting-approval` when the fork gate is on.",
		capability: ["service.deploy"],
	},
	"previewDeployment.approve": {
		summary: "Approve a fork preview",
		description:
			"Releases a preview held by the fork-approval gate and queues its deploy. Approving runs untrusted code from the fork — review the diff first.",
		capability: ["service.deploy"],
	},
	"previewDeployment.deny": {
		summary: "Deny a fork preview",
		description: "Rejects a preview awaiting approval; nothing is built.",
		capability: ["service.deploy"],
	},
	"previewDeployment.delete": {
		summary: "Delete a preview deployment",
		description:
			"Removes the preview's Swarm service (or compose project), its domains and its row.",
		capability: ["service.deploy"],
	},

	// ────────────────────────────────────────────────────────────── domains
	"domain.checkDns": {
		summary: "Check a host's DNS",
		description:
			"Resolves a hostname and compares the A records with this server's public IP. Advisory — DNS may be propagating, and hosts behind a CDN resolve elsewhere on purpose.",
	},
	"domain.all": {
		summary: "List domains",
		description:
			"Domains of an application, a compose service, or every service in a project (exactly one id).",
	},
	"domain.byApplication": {
		summary: "List domains of an application",
		description: "Domains attached to one application, in creation order.",
	},
	"domain.byCompose": {
		summary: "List domains of a compose service",
		description: "Domains attached to one compose stack, including the target service name.",
	},
	"domain.one": {
		summary: "Get one domain",
		description: "Host, path, port, TLS settings and internal path of a single domain row.",
	},
	"domain.create": {
		summary: "Attach a domain",
		description:
			"Creates the domain and rewrites the Traefik file-provider YAML. Hosts are unique across the whole instance, not just the organization.",
		capability: ["domains.manage"],
	},
	"domain.update": {
		summary: "Update a domain",
		description:
			"Changes host, path, port, HTTPS or certificate and re-syncs Traefik. Switching to Let's Encrypt triggers an HTTP-01 challenge on the next request.",
		capability: ["domains.manage"],
	},
	"domain.delete": {
		summary: "Delete a domain",
		description: "Removes the row and the Traefik route. Issued certificates are left in place.",
		capability: ["domains.manage"],
	},
	"domain.middlewares": {
		summary: "List the middleware chain of a domain",
		description:
			"Ordered Traefik middlewares (rate limit, IP allow-list, headers, …) of one domain.",
	},
	"domain.saveMiddlewares": {
		summary: "Replace the middleware chain of a domain",
		description:
			"Replace-all so reordering, adding and removing are one atomic write and Traefik is rewritten exactly once. Every config is validated before anything is persisted.",
		capability: ["domains.manage"],
	},
	"domain.generateDomain": {
		summary: "Generate a free traefik.me host",
		description:
			"Returns `<appName>-<random>.traefik.me`, which resolves to 127.0.0.1 — handy for local and LAN testing.",
	},
	"domain.validateHost": {
		summary: "Check whether a host is available",
		description: "Instance-wide uniqueness check, optionally ignoring one existing domain row.",
	},

	// ───────────────────────────────────────────────────────────── backups
	"backup.all": {
		summary: "List backup schedules",
		description:
			"Schedules of one database service, or of the instance itself (`databaseType: web-server`), each with its most recent run.",
	},
	"backup.one": {
		summary: "Get one backup schedule",
		description: "Cron expression, destination, retention and last run of a schedule.",
	},
	"backup.create": {
		summary: "Create a backup schedule",
		description:
			"Registers the cron job and its retention policy. The first run happens at the next cron tick unless you call `backup.runManually`.",
		capability: ["backups.manage"],
		instanceAdmin: true,
	},
	"backup.update": {
		summary: "Update a backup schedule",
		description: "Re-registers the cron job when the expression or enabled flag changes.",
		capability: ["backups.manage"],
		instanceAdmin: true,
	},
	"backup.remove": {
		summary: "Delete a backup schedule",
		description: "Unregisters the cron job. Objects already uploaded to the destination are kept.",
		capability: ["backups.manage"],
		instanceAdmin: true,
	},
	"backup.runManually": {
		summary: "Run a backup now",
		description:
			"Dumps the database, uploads it to the destination and applies retention. Records a `backup_run` row and sends the configured notification.",
		capability: ["backups.manage"],
		instanceAdmin: true,
	},
	"backup.runs": {
		summary: "List backup runs",
		description: "Run history with status, trigger, byte size, object key and error, newest first.",
	},
	"backup.listBackups": {
		summary: "List stored dumps",
		description: "Object keys held by the destination for this schedule, newest first.",
	},
	"backup.restore": {
		summary: "Restore a dump",
		description:
			"Destructive: restores the stored dump into the live database, overwriting current data. Defaults to the newest object when no key is given.",
		capability: ["backups.manage"],
	},
	"backup.verify": {
		summary: "Verify a dump",
		description:
			"Restores the dump into a throwaway container and runs a liveness query. Never touches the live database; records the verdict on the run row.",
		capability: ["backups.manage"],
		instanceAdmin: true,
	},
	"volumeBackup.all": {
		summary: "List volume backup schedules",
		description: "Named-volume backup schedules of one application or compose service.",
	},
	"volumeBackup.one": {
		summary: "Get one volume backup schedule",
		description: "Volume name, cron expression, destination and retention.",
	},
	"volumeBackup.create": {
		summary: "Create a volume backup schedule",
		description: "Tars a named Docker volume on a cron and uploads it to the destination.",
		capability: ["backups.manage"],
	},
	"volumeBackup.update": {
		summary: "Update a volume backup schedule",
		description: "Re-registers the cron job when the expression or enabled flag changes.",
		capability: ["backups.manage"],
	},
	"volumeBackup.remove": {
		summary: "Delete a volume backup schedule",
		description: "Unregisters the cron job; uploaded archives are kept.",
		capability: ["backups.manage"],
	},
	"volumeBackup.runManually": {
		summary: "Run a volume backup now",
		description: "Archives the volume and uploads it, recording a `backup_run` row.",
		capability: ["backups.manage"],
	},
	"volumeBackup.runs": {
		summary: "List volume backup runs",
		description: "Run history for a volume schedule, newest first.",
	},
	"volumeBackup.listBackups": {
		summary: "List stored volume archives",
		description: "Object keys held by the destination for this volume schedule.",
	},
	"volumeBackup.restore": {
		summary: "Restore a volume archive",
		description:
			"Destructive: unpacks the archive back into the named volume, overwriting its contents. Stop the service first.",
		capability: ["backups.manage"],
	},
	"destination.all": {
		summary: "List backup destinations",
		description:
			"S3-compatible and local-disk destinations. Keys are redacted without secrets.read.",
	},
	"destination.one": {
		summary: "Get one backup destination",
		description: "Destination settings; the secret access key is redacted without secrets.read.",
	},
	"destination.create": {
		summary: "Create a backup destination",
		description:
			"S3-compatible bucket or the panel host's own disk. Endpoints are checked against SSRF targets (cloud metadata, private ranges) before being accepted.",
		capability: ["destinations.manage"],
		instanceAdmin: true,
	},
	"destination.update": {
		summary: "Update a backup destination",
		description: "Rotates credentials or points the destination at another bucket.",
		capability: ["destinations.manage"],
	},
	"destination.remove": {
		summary: "Delete a backup destination",
		description: "Schedules pointing at it stop working; stored objects are not deleted.",
		capability: ["destinations.manage"],
	},
	"destination.testConnection": {
		summary: "Test a backup destination",
		description: "Lists the bucket with the stored credentials and reports the result.",
		capability: ["destinations.manage"],
	},

	// ──────────────────────────────────────────────────────────── schedules
	"schedule.all": {
		summary: "List cron schedules",
		description: "Every schedule of the instance with its cron expression and target.",
		instanceAdmin: true,
	},
	"schedule.byService": {
		summary: "List schedules of one service",
		description: "Schedules attached to an application, compose stack, server or the panel itself.",
		instanceAdmin: true,
	},
	"schedule.one": {
		summary: "Get one schedule",
		description: "Cron expression, shell, command and last run of a schedule.",
	},
	"schedule.create": {
		summary: "Create a cron schedule",
		description:
			"Runs a shell command inside a running container, on a managed server, or on the panel host. Container schedules need the target service to be running.",
		capability: ["schedules.manage"],
	},
	"schedule.update": {
		summary: "Update a schedule",
		description: "Re-registers the node-schedule job when the cron expression changes.",
		capability: ["schedules.manage"],
	},
	"schedule.remove": {
		summary: "Delete a schedule",
		description: "Unregisters the cron job and removes the row and its run history.",
		capability: ["schedules.manage"],
	},
	"schedule.runOnce": {
		summary: "Run a command once from an image",
		description:
			"One-off job in a throwaway `docker run --rm` container on the service's environment overlay, with the merged env handed over a 0600 env file. No schedule row is created; the output lands in the service's run history.",
		capability: ["schedules.manage", "secrets.read"],
	},
	"schedule.runManually": {
		summary: "Run a schedule now",
		description: "Executes the command once, recording the output as a deployment-style log row.",
		capability: ["schedules.manage"],
	},
	"schedule.enable": {
		summary: "Enable a schedule",
		description: "Re-registers the cron job.",
		capability: ["schedules.manage"],
	},
	"schedule.disable": {
		summary: "Disable a schedule",
		description: "Unregisters the cron job but keeps the row and its history.",
		capability: ["schedules.manage"],
	},

	// ─────────────────────────────────────────────────────────────── fleet
	"server.all": {
		summary: "List managed servers",
		description: "Remote Docker Swarm nodes joined over SSH, with status and role.",
	},
	"server.one": {
		summary: "Get one managed server",
		description: "Connection details of a server. The SSH key material is never returned.",
	},
	"server.create": {
		summary: "Register a remote server",
		description:
			"Stores the SSH connection. Nothing is installed until `server.setup`; the host key is pinned on first contact.",
		capability: ["servers.manage"],
		instanceAdmin: true,
	},
	"server.update": {
		summary: "Update a managed server",
		description: "Changes address, credentials, Swarm role, metrics sampling or cleanup settings.",
		capability: ["servers.manage"],
		instanceAdmin: true,
	},
	"server.remove": {
		summary: "Remove a managed server",
		description:
			"Drops the row; services pinned to it stop being managed. The remote host is not touched.",
		capability: ["servers.manage"],
	},
	"server.setup": {
		summary: "Provision a server and join the Swarm",
		description:
			"Installs Docker if missing and joins the node to the primary Swarm over SSH. Long-running: the call returns when provisioning finishes.",
		capability: ["servers.manage"],
		instanceAdmin: true,
	},
	"server.testConnection": {
		summary: "Test SSH reachability",
		description:
			"Opens an SSH session with the stored credentials and reports the result. Closes the server's SSH circuit breaker first, so it doubles as the manual retry after an outage.",
		capability: ["servers.manage"],
	},
	"server.transportState": {
		summary: "Get SSH transport health",
		description:
			'Per-server view of the panel\'s SSH connection pool: whether a pooled connection is live, how many channels it holds, the consecutive connection failures and — while the circuit breaker is open — `status: "unreachable"` plus the time Nixploy will retry. Process-local state, not a stored column; `lastError` is only returned to callers with servers.manage.',
	},
	"server.getStats": {
		summary: "Get server stats",
		description: "Docker version, container counts, CPU load, memory and disk, sampled over SSH.",
	},
	"server.getStatsBatch": {
		summary: "Get stats for several servers",
		description: "One round trip per server, in parallel; used by the fleet table.",
	},

	// ─────────────────────────────────────────────────────────── monitoring
	"monitoring.serverStats": {
		summary: "Get host stats",
		description:
			"The panel host itself when `serverId` is omitted (instance-admin only), otherwise a managed server over SSH.",
		instanceAdmin: true,
	},
	"monitoring.replicaStats": {
		summary: "Get live per-replica stats",
		description:
			"One-shot CPU/memory/PID stats for every running task of a service, by `appName`. Services pinned to a managed server are sampled over SSH; the row's `serverId` wins over the argument.",
	},
	"monitoring.history": {
		summary: "Get sampled service metrics",
		description:
			"CPU/memory history from the 30-second sampler, up to 48 hours. Covers local and remote-hosted services.",
	},
	"monitoring.serverHistory": {
		summary: "Get sampled server metrics",
		description: "Host CPU/memory/disk history of a managed server, up to 48 hours.",
	},
	"monitoring.fleetOverview": {
		summary: "List every service with its latest metrics",
		description:
			"Organization-wide fleet view: kind, status, project, environment and the most recent metrics sample per service.",
	},

	// ──────────────────────────────────────────────────────── observability
	"observability.incidents": {
		summary: "List incidents",
		description:
			"Alert firings, deploy-failure streaks, watchdog events and uptime flips, newest first.",
	},
	"observability.serviceEvents": {
		summary: "List a service's event timeline",
		description:
			"Deploys, task failures, out-of-memory kills, status drift and config changes for one service, newest first. Keyset-paginated with `cursor`.",
	},
	"observability.alertRules": {
		summary: "List alert rules of a service",
		description: "CPU, memory, restart and deploy-failure-streak rules with thresholds.",
	},
	"observability.upsertAlertRule": {
		summary: "Create or update an alert rule",
		description: "Thresholds are evaluated by the monitoring cron; cooldown suppresses repeats.",
		capability: ["project.write"],
	},
	"observability.deleteAlertRule": {
		summary: "Delete an alert rule",
		description: "Existing incidents raised by the rule are kept.",
		capability: ["project.write"],
	},
	"observability.uptimeProbes": {
		summary: "List uptime probes",
		description: "Probes attached to domains, with last status and last check time.",
	},
	"observability.setUptimeProbe": {
		summary: "Configure an uptime probe",
		description:
			"Enables or disables HTTP probing for a domain and sets path, expected status and interval.",
		capability: ["project.write"],
	},
	"observability.acknowledgeIncident": {
		summary: "Acknowledge an incident",
		description:
			"Marks the incident as being worked on: it stays open but stops re-notifying. Records who acknowledged it.",
		capability: ["project.write"],
	},
	"observability.resolveIncident": {
		summary: "Resolve an incident",
		description:
			"Closes the incident with an optional note. Resolving does not fix the underlying condition — an alert rule that still breaches will raise a new incident after its cooldown.",
		capability: ["project.write"],
	},
	"observability.statusPage": {
		summary: "Get the public status page settings",
		description: "Which probes are published, the page title and its token, if a page exists.",
	},
	"observability.enableStatusPage": {
		summary: "Publish a public status page",
		description:
			"Exposes the selected uptime probes at `/status/<token>` without authentication. Organization-level decision — requires settings.manage.",
		capability: ["settings.manage"],
	},
	"observability.disableStatusPage": {
		summary: "Unpublish the status page",
		description: "The `/status/<token>` URL stops responding immediately.",
		capability: ["settings.manage"],
	},
	"observability.rotateStatusPageToken": {
		summary: "Rotate the status page token",
		description: "Invalidates the old public URL and issues a new one.",
		capability: ["settings.manage"],
	},
	"observability.searchLogs": {
		summary: "Search persisted service logs",
		description:
			"Full-text search over the `service_log` table. Runtime container logs are live-only; this covers what the platform persisted (deploy failures, ingested logs).",
	},

	// ────────────────────────────────────────────────────── infrastructure
	"registry.all": {
		summary: "List private registries",
		description: "Registry credentials of the organization. Passwords are redacted.",
	},
	"registry.one": {
		summary: "Get one registry",
		description: "Registry settings; the password is redacted without secrets.read.",
	},
	"registry.create": {
		summary: "Add a private registry",
		description:
			"Stores the credential encrypted. Image pulls match a registry by host prefix at deploy time.",
		capability: ["registries.manage"],
	},
	"registry.update": {
		summary: "Update a private registry",
		description: "Rotates the credential or changes the URL and image prefix.",
		capability: ["registries.manage"],
	},
	"registry.remove": {
		summary: "Delete a private registry",
		description: "Services pulling from it will fail their next deploy.",
		capability: ["registries.manage"],
	},
	"registry.test": {
		summary: "Test a registry login",
		description:
			"Runs `docker login` on the panel host or a managed server and reports the result.",
		capability: ["registries.manage"],
		instanceAdmin: true,
	},
	"sshKey.all": {
		summary: "List SSH keys",
		description: "Keys used for git clones and server access. Private keys are redacted.",
	},
	"sshKey.one": {
		summary: "Get one SSH key",
		description: "Public key and metadata; the private key is redacted without secrets.read.",
	},
	"sshKey.create": {
		summary: "Add an SSH key",
		description: "Stores an existing key pair; the private key is encrypted at rest.",
		capability: ["ssh_keys.manage"],
	},
	"sshKey.generate": {
		summary: "Generate an SSH key pair",
		description: "Creates an ed25519 pair inside the panel and returns the public half.",
		capability: ["ssh_keys.manage"],
	},
	"sshKey.update": {
		summary: "Rename an SSH key",
		description: "Changes name and description only; the key material is immutable.",
		capability: ["ssh_keys.manage"],
	},
	"sshKey.remove": {
		summary: "Delete an SSH key",
		description: "Servers and git sources referencing it stop authenticating.",
		capability: ["ssh_keys.manage"],
	},
	"certificate.all": {
		summary: "List custom TLS certificates",
		description: "Uploaded certificates available to domains with `certificateType: custom`.",
	},
	"certificate.one": {
		summary: "Get one custom certificate",
		description: "Certificate metadata; the private key is redacted.",
	},
	"certificate.create": {
		summary: "Upload a custom certificate",
		description: "Writes the pair to the Traefik dynamic directory and stores it encrypted.",
		capability: ["certificates.manage"],
		instanceAdmin: true,
	},
	"certificate.update": {
		summary: "Replace a custom certificate",
		description: "Rewrites the Traefik dynamic file; live connections pick the new cert up.",
		capability: ["certificates.manage"],
		instanceAdmin: true,
	},
	"certificate.delete": {
		summary: "Delete a custom certificate",
		description: "Domains using it fall back to the default certificate.",
		capability: ["certificates.manage"],
		instanceAdmin: true,
	},

	// ───────────────────────────────────────────────────── notifications
	"notification.all": {
		summary: "List notification channels",
		description: "Configured channels with their per-event toggles. Tokens are redacted.",
	},
	"notification.one": {
		summary: "Get one notification channel",
		description: "Channel configuration; webhooks, tokens and passwords are redacted.",
	},
	"notification.create": {
		summary: "Create a notification channel",
		description:
			"One of 11 providers (Slack, Discord, Telegram, email, ntfy, …) with per-event toggles. Config is stored encrypted.",
		capability: ["notifications.manage"],
	},
	"notification.update": {
		summary: "Update a notification channel",
		description: "Changes provider config or event toggles.",
		capability: ["notifications.manage"],
	},
	"notification.remove": {
		summary: "Delete a notification channel",
		description: "Events stop being delivered immediately.",
		capability: ["notifications.manage"],
	},
	"notification.test": {
		summary: "Send a test notification",
		description:
			"Delivers a sample message through a saved channel, or through an unsaved config passed inline.",
		capability: ["notifications.manage"],
	},

	// ──────────────────────────────────────────────────────── organization
	"organization.list": {
		summary: "List the caller's organizations",
		description:
			"Organizations the API key's user belongs to, oldest membership first, each with the caller's role and an `active` flag for the one this request resolves to.",
	},
	"organization.settings": {
		summary: "Get organization settings",
		description: "Name, quotas, branding, 2FA enforcement and service counts.",
	},
	"organization.updateSettings": {
		summary: "Update organization settings",
		description: "Quotas, branding, logo and the org-wide two-factor requirement.",
		capability: ["settings.manage"],
	},
	"organization.environment": {
		summary: "Get the shared (organization) env vars",
		description:
			"Top of the inheritance chain: inherited by every project, environment and service. `env` is null without secrets.read.",
	},
	"organization.saveEnvironment": {
		summary: "Replace the shared env vars",
		description: "Organization-scope `.env` blob. Replace-all: merge client-side first.",
		capability: ["settings.manage", "secrets.write"],
	},
	"organization.inviteMember": {
		summary: "Invite a member",
		description:
			"Creates an invitation with an expiry and emails it when an email channel is configured.",
		capability: ["members.manage"],
	},
	"organization.capabilityCatalog": {
		summary: "List the capability catalog",
		description: "Fixed vocabulary of capability ids with labels and groups.",
	},
	"organization.myCapabilities": {
		summary: "List the caller's capabilities",
		description:
			"Effective capabilities of the API key's user in the resolved organization (role defaults plus per-member overrides).",
	},
	"organization.memberCapabilities": {
		summary: "List a member's capabilities",
		description: "Role defaults plus the member's explicit grants and revokes.",
		capability: ["members.manage"],
	},
	"organization.setMemberCapabilities": {
		summary: "Set a member's capability overrides",
		description: "Grants and revokes layered on top of the member's role.",
		capability: ["members.manage"],
	},

	// ─────────────────────────────────────────────────────────────── teams
	"team.all": {
		summary: "List teams",
		description:
			"Every team of the active organization with its members and the projects it reaches. Teams decide *where* a member works; their organization role still decides what they may do.",
		capability: ["members.manage"],
	},
	"team.memberScopes": {
		summary: "List members with their project scope",
		description:
			"Everyone in the organization with their role and whether they see every project (`organization`) or only their teams' (`teams`).",
		capability: ["members.manage"],
	},
	"team.create": {
		summary: "Create a team",
		description:
			"Names a new, empty team. Attach projects with `team.setProjects` and people with `team.setMembers`; a team constrains nobody until a member's project scope is set to `teams`.",
		capability: ["members.manage"],
	},
	"team.update": {
		summary: "Rename a team",
		description: "Changes the team's name or description. Membership and projects are untouched.",
		capability: ["members.manage"],
	},
	"team.delete": {
		summary: "Delete a team",
		description:
			"Removes the team and its memberships and project attachments. Members scoped to `teams` immediately lose the projects only this team reached — the audit row records how many people were affected.",
		capability: ["members.manage"],
	},
	"team.setMembers": {
		summary: "Replace a team's members",
		description:
			"Sets the team's member list wholesale. User ids that are not already members of the organization are ignored — a team is a subset of the membership, never a way into it.",
		capability: ["members.manage"],
	},
	"team.setProjects": {
		summary: "Replace a team's projects",
		description:
			"Sets the projects this team reaches, wholesale. Project ids belonging to another organization are ignored.",
		capability: ["members.manage"],
	},
	"team.setMemberScope": {
		summary: "Set a member's project scope",
		description:
			"Switches a member between `organization` (sees every project) and `teams` (sees only the projects their teams reach; none if they are in no team). Refused for your own membership, and for owners and admins, who administer the whole organization.",
		capability: ["members.manage"],
	},

	// ──────────────────────────────────────────────────────────── platform
	"audit.all": {
		summary: "List audit events",
		description:
			"Organization audit trail, newest first, filterable by action, target type, target name and a `since`/`until` window (ISO, or `30m`/`24h`/`7d`). Returns `{ rows, total }`.",
		capability: ["audit.read"],
	},
	"audit.facets": {
		summary: "List audit filter facets",
		description: "Distinct actions and target types present in the organization's trail.",
		capability: ["audit.read"],
	},
	"audit.export": {
		summary: "Export the audit trail as CSV",
		description:
			"The organization's audit rows rendered as CSV (header + one line per event), newest first, capped by `limit` and narrowed by the same filters as `audit.all`. Returns `{ filename, rows, csv }`.",
		capability: ["audit.read"],
	},
	"updates.banner": {
		summary: "Get the update banner state",
		description: "Whether a newer panel image is available, for the in-app banner.",
	},
	"updates.getStatus": {
		summary: "Get update status",
		description: "Current version and digest, update settings and the result of the last check.",
		instanceAdmin: true,
	},
	"updates.check": {
		summary: "Check for a panel update",
		description: "Queries GHCR for the configured image tag and compares digests.",
		instanceAdmin: true,
	},
	"updates.runUpdate": {
		summary: "Apply the panel update",
		description:
			"Pulls the image and rolls the `nixploy` Swarm service. The panel restarts itself; the request may not return. Rolls back automatically when the new task fails to become healthy.",
		instanceAdmin: true,
	},
	"updates.updateSettings": {
		summary: "Update the updater settings",
		description: "Auto-check, auto-update, check cron and the image to track.",
		instanceAdmin: true,
	},
	"template.all": {
		summary: "List the template catalog",
		description: "Fixed catalog of one-click compose templates, grouped by category.",
	},
	"template.one": {
		summary: "Get one template",
		description: "Compose body, env schema, default domains and documentation of a template.",
	},
	"template.sourcesList": {
		summary: "List template sources",
		description:
			"Remote template catalogs of the organization, with the diagnostics of their last sync (rejected entries, unreachable images).",
	},
	"template.sourcesCreate": {
		summary: "Add a template source",
		description:
			"A JSON index URL (`http-json`) or a git repository carrying `templates/index.json`. The URL is checked against the egress policy here and again on every sync. Nothing is fetched until `template.sourcesSync`.",
	},
	"template.sourcesUpdate": {
		summary: "Update a template source",
		description:
			"Rename, re-point, change branch, or enable/disable it. A disabled source contributes no templates.",
	},
	"template.sourcesDelete": {
		summary: "Delete a template source",
		description:
			"Removes the row and its cached catalog. Services already deployed from it are untouched.",
	},
	"template.sourcesSync": {
		summary: "Sync a template source",
		description:
			"Fetches the index now, validates every entry, probes the images it references and rewrites the cache. Invalid entries and unreachable images are reported, not fatal.",
	},
	"template.deploy": {
		summary: "Deploy a template",
		description:
			"Creates a compose service from the template, fills its env schema (generating secrets where the template asks for them), attaches the requested domains and deploys.",
		capability: ["templates.deploy", "secrets.write", "domains.manage"],
		instanceAdmin: true,
	},
	"traefik.listEntrypoints": {
		summary: "List Traefik TCP/UDP entrypoints",
		description:
			"Extra layer-4 entrypoints a tcp/udp domain can bind to. Readable by any member so the domain form can offer them.",
	},
	"traefik.createEntrypoint": {
		summary: "Add a Traefik TCP/UDP entrypoint",
		description:
			"Declares the entrypoint in Traefik's static config and publishes the host port on the nixploy-traefik service. The static config is only read at start, so this recreates the proxy task — every route on the instance is briefly unavailable (~9 s). Host ports are instance-wide, hence instance-admin only.",
		instanceAdmin: true,
	},
	"traefik.deleteEntrypoint": {
		summary: "Remove a Traefik TCP/UDP entrypoint",
		description:
			"Unpublishes the port and drops the entrypoint from the static config, restarting the proxy. Refused while a domain still routes through it.",
		instanceAdmin: true,
	},
	"tag.all": {
		summary: "List organization tags",
		description: "Tags available for assignment to services.",
	},
	"tag.create": {
		summary: "Create a tag",
		description: "Names are unique per organization.",
		capability: ["tags.manage"],
	},
	"tag.update": {
		summary: "Rename or recolour a tag",
		description: "Assignments are preserved.",
		capability: ["tags.manage"],
	},
	"tag.delete": {
		summary: "Delete a tag",
		description: "Detaches the tag from every service.",
		capability: ["tags.manage"],
	},
	"tag.setServiceTags": {
		summary: "Replace the tags of a service",
		description: "Replace-all: pass an empty list to clear every tag.",
		capability: ["tags.manage"],
	},
	"tag.forServices": {
		summary: "List tags of several services",
		description: "Batch lookup used by the project and service lists.",
	},
	"gitops.exportStack": {
		summary: "Export an environment as nixploy.yaml",
		description:
			"Version 2 desired-state manifest for one project environment: every service with its domains, middlewares, mounts, ports, redirects, basic auth, hooks, Swarm overrides and preview settings; registries and servers by name; env as key names only. Hook commands, inline compose files and file-mount contents are included only with secrets.read.",
		capability: ["gitops.manage"],
	},
	"gitops.plan": {
		summary: "Plan a nixploy.yaml apply",
		description:
			"Diffs the manifest against the live stack and returns one create/update/delete/no-op item per service and child row, with the manifest paths that changed. Accepts version 1 and 2 files.",
		capability: ["gitops.manage"],
	},
	"gitops.runApply": {
		summary: "Apply a nixploy.yaml",
		description:
			"Converges the live stack to the manifest and redeploys the services that changed (redeploy: false skips it). With `secrets`, a sealed bundle is written after the rows and before the redeploy. Needs secrets.write when the file carries hooks, passwords or file contents, and the instance admin for bind mounts, Swarm network/privilege overrides and publishPorts. Not a dry run.",
		capability: ["gitops.manage"],
	},
	"gitops.exportSecrets": {
		summary: "Seal an environment's env values with a passphrase",
		description:
			"The values the manifest leaves out — project, environment and per-service env plus build args and preview env — as a `nixploy-secrets:1:` bundle (scrypt + AES-256-GCM). Apply it elsewhere with applySecrets or runApply.secrets.",
		capability: ["gitops.manage", "secrets.read"],
	},
	"gitops.applySecrets": {
		summary: "Write a sealed secrets bundle onto an environment",
		description:
			"Opens the bundle with its passphrase and writes the values onto the project, the environment and the services it names, in one transaction. Names the target lacks are reported as missing. The values reach containers on the next deploy.",
		capability: ["gitops.manage", "secrets.write"],
	},
	"gitops.syncFromUrl": {
		summary: "Apply a nixploy.yaml fetched from an https URL",
		description:
			"Fetches the manifest from the given URL (a raw GitHub/GitLab file), applies it and redeploys the changed services. The URL is checked against SSRF targets.",
		capability: ["gitops.manage"],
	},
	"import.inspect": {
		summary: "List what a source panel's API key can see",
		description:
			"Connects to another panel over its REST API (the URL is checked against SSRF targets) and returns its projects, environments and service counts — nothing that could hold a value. The key is used for this call and forgotten.",
		capability: ["gitops.manage"],
	},
	"import.plan": {
		summary: "Translate one source environment and diff it against the target",
		description:
			"Fetches every service of the chosen source environment, translates it to a version-2 nixploy.yaml (keys only) plus notes for what does not carry over, and diffs it against the target project environment (every item is a create when the target does not exist yet). Writes nothing.",
		capability: ["gitops.manage"],
	},
	"import.runApply": {
		summary: "Import one source environment: rows, then env values, no deploy",
		description:
			"Creates the target project and environment when missing (project.write, project quota), applies the translated manifest with the same gates as gitops.runApply, then writes the source's env values, build args and preview env onto the rows (secrets.write). Nothing is deployed; services land idle. Returns the plan, the notes and what could not be applied.",
		capability: ["gitops.manage", "secrets.write"],
	},
	"gitops.syncFromGit": {
		summary: "Apply a nixploy.yaml sent in the request body",
		description:
			"The webhook-style variant of runApply: takes the manifest text as `yaml`, applies it and redeploys the changed services.",
		capability: ["gitops.manage"],
	},
	"setup.needsSetup": {
		summary: "Check whether first-boot setup is pending",
		description: "Public: true until the first owner account exists.",
	},
	// ────────────────────────────────────────────────────────────── branding
	"branding.public": {
		summary: "Read the instance branding",
		description:
			"Product name, logos, favicon, accent and copy. Public: the login page and the setup wizard render it before any session exists.",
	},
	"branding.settings": {
		summary: "Read the branding settings",
		description: "Instance admin only. The stored values, for the settings form.",
	},
	"branding.update": {
		summary: "Update the instance branding",
		description:
			"Instance admin only. Custom CSS is sanitised on save; support and docs URLs go through the outbound-request guard.",
	},
	"branding.clearAsset": {
		summary: "Remove an uploaded branding asset",
		description:
			"Instance admin only. Uploading is a route handler (`POST /api/branding/upload/<slot>`) because the payload is binary.",
	},
	// ─────────────────────────────────────────────────────────────────── sso
	"sso.presets": {
		summary: "List identity-provider presets",
		description:
			"The known IdPs (Authentik, Keycloak, Entra, Okta, ZITADEL, Google, GitHub) with their default scopes, group claim and setup notes.",
	},
	"sso.all": {
		summary: "List SSO providers",
		description: "Every configured identity provider. Client secrets are never returned.",
	},
	"sso.redirectUri": {
		summary: "Redirect URI for a provider id",
		description:
			"The callback URL to register at the identity provider. Derived from the panel's configured base URL.",
	},
	"sso.create": {
		summary: "Add an SSO provider",
		description:
			"Instance admin only. Every URL goes through the outbound-request guard, and the auth instance is rebuilt so the provider works immediately.",
	},
	"sso.update": {
		summary: "Update an SSO provider",
		description:
			"Instance admin only. Omit `clientSecret` to keep the stored one — the panel never reads it back.",
	},
	"sso.delete": {
		summary: "Remove an SSO provider",
		description:
			"Instance admin only. Refused while an organization still requires SSO and this is the last provider.",
	},
	"sso.requirement": {
		summary: "Read this organization's SSO requirement",
		description:
			"Whether SSO is required, whether it could be enabled at all, and why not — so the panel can disable the switch instead of failing on save.",
	},
	"sso.setRequirement": {
		summary: "Require SSO for this organization",
		description:
			"Needs `settings.manage`. Turning it on is refused when no admin or owner has an SSO identity yet, which would lock everyone out — including whoever would turn it off.",
	},
	"setup.authConfig": {
		summary: "Get the public auth configuration",
		description:
			"Public: which SSO providers the login page should offer and whether password reset is available (an email provider is configured). Rate-limited per IP.",
	},
	"setup.invitationPreview": {
		summary: "Preview an invitation",
		description:
			"Public: organization name and inviter for an invitation id, used by the accept page.",
	},
	"webServer.getSettings": {
		summary: "Get panel and Traefik settings",
		description: "Dashboard domain, Let's Encrypt email, cleanup schedule and Traefik state.",
		instanceAdmin: true,
	},
	"webServer.updateSettings": {
		summary: "Update panel and Traefik settings",
		description: "Changing the dashboard domain rewrites the Traefik config for the panel itself.",
		instanceAdmin: true,
	},
	"webServer.acmeDnsProviders": {
		summary: "List supported ACME DNS providers",
		description: "Provider ids accepted for DNS-01 challenges.",
		instanceAdmin: true,
	},
	"webServer.checkDashboardDomain": {
		summary: "Check the dashboard domain",
		description: "Verifies that the configured panel host resolves and answers through Traefik.",
		instanceAdmin: true,
	},
	"webServer.getTraefikConfig": {
		summary: "Read the Traefik static config",
		description: "The rendered static configuration file the panel manages.",
		instanceAdmin: true,
	},
	"webServer.restartTraefik": {
		summary: "Restart Traefik",
		description: "Rolls the `nixploy-traefik` Swarm service. Routing blips for a second or two.",
		instanceAdmin: true,
	},
	"webServer.dockerCleanupNow": {
		summary: "Run Docker cleanup now",
		description:
			"Prunes unused images, containers and build cache on the host. Guarded so running services are never removed.",
		instanceAdmin: true,
	},
	"docker.containers": {
		summary: "List containers",
		description:
			"Control-centre container list for the host or a managed server. Without `serverId` this reads the panel host's own socket, which sees every organization's containers — instance admin only.",
		capability: ["docker.manage"],
	},
	"docker.containerAction": {
		summary: "Start, stop, restart or remove a container",
		description: "Raw daemon control; bypasses the service abstraction.",
		capability: ["docker.manage"],
	},
	"docker.images": {
		summary: "List images",
		description: "Images on the host or a managed server, with sizes.",
		capability: ["docker.manage"],
	},
	"docker.imagePull": {
		summary: "Pull an image",
		description: "Pulls into the local image store using any matching registry credential.",
		capability: ["docker.manage"],
	},
	"docker.imageRemove": {
		summary: "Remove an image",
		description: "Fails when a container still references the image.",
		capability: ["docker.manage"],
	},
	"docker.imagesPrune": {
		summary: "Prune dangling images",
		description: "Frees disk by removing untagged layers.",
		capability: ["docker.manage"],
	},
	"docker.swarmServices": {
		summary: "List Swarm services",
		description: "Every service on the Swarm, including ones Nixploy does not manage.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"docker.nodes": {
		summary: "List Swarm nodes",
		description: "Node list with role, availability and status.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"docker.nodeUpdate": {
		summary: "Update a Swarm node",
		description: "Drain, pause or activate a node. Draining reschedules its tasks elsewhere.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"docker.networks": {
		summary: "List Docker networks",
		description: "Networks on the host or a managed server.",
		capability: ["docker.manage"],
	},
	"docker.networkRemove": {
		summary: "Remove a Docker network",
		description:
			"Refuses to remove networks Nixploy manages (`nixploy-network`, per-app networks).",
		capability: ["docker.manage"],
	},
	"docker.volumes": {
		summary: "List Docker volumes",
		description: "Volumes with their size where the daemon reports it.",
		capability: ["docker.manage"],
	},
	"docker.volumeRemove": {
		summary: "Remove a Docker volume",
		description: "Destructive: the data is gone. Guarded against volumes in use.",
		capability: ["docker.manage"],
	},
	"docker.volumesPrune": {
		summary: "Prune unused volumes",
		description: "Destructive: removes every volume no container references.",
		capability: ["docker.manage"],
	},
	"volumeFiles.list": {
		summary: "List files in a Docker volume",
		description:
			"Directory listing inside a volume, produced by a throwaway `alpine` container with the volume mounted read-only and no network. Paths are confined to the mount: `..` is rejected before the command is built and the container's resolved `realpath` is verified again, so a symlink cannot read outside the volume. At most 1000 entries per call. Volumes are instance-level Docker resources, so this needs the instance admin on top of docker.manage.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"volumeFiles.read": {
		summary: "Read a text file from a Docker volume",
		description:
			"Contents of one file, capped at 512 KiB (the check runs in the container, so a huge file is never streamed out). Binary files are refused — use a volume backup to get those.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"volumeFiles.write": {
		summary: "Write a text file into a Docker volume",
		description:
			"Creates or overwrites one file. The payload travels over stdin (never argv, where `ps` would show it) and the parent directory must already exist. Audited as `docker.volume.file.write`.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"volumeFiles.delete": {
		summary: "Delete a path in a Docker volume",
		description:
			"Removes a file, or a directory and everything under it. Refuses the volume root. Audited as `docker.volume.file.delete`. There is no undo — take a volume backup first.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"volumeFiles.mkdir": {
		summary: "Create a directory in a Docker volume",
		description:
			"Creates one directory whose parent already exists. Audited as `docker.volume.file.mkdir`.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"docker.systemInfo": {
		summary: "Get Docker system info",
		description: "Daemon version, driver, Swarm state and resource totals.",
		capability: ["docker.manage"],
	},
	"docker.systemPrune": {
		summary: "Prune the Docker system",
		description: "Destructive: images, containers, networks and build cache. Guarded.",
		capability: ["docker.manage"],
		instanceAdmin: true,
	},
	"ai.getSettings": {
		summary: "Get Copilot settings",
		description: "Provider, model and feature toggles. The API key is never returned.",
	},
	"ai.updateSettings": {
		summary: "Update Copilot settings",
		description: "Bring-your-own provider key, model and auto-explain toggle.",
	},
	"ai.explainDeployment": {
		summary: "Explain a failed deployment",
		description:
			"Sends the tail of the build log to the configured provider and stores the answer.",
	},
	"ai.getExplanation": {
		summary: "Get a stored explanation",
		description: "The last Copilot explanation for a deployment, if any.",
	},
	"ai.applySuggestedPatch": {
		summary: "Apply a suggested env patch",
		description: "Writes the Copilot-suggested env change and redeploys the service.",
		capability: ["ai.use", "secrets.write", "service.deploy"],
	},
	"ai.chat": {
		summary: "Chat with the Copilot about a service",
		description:
			"Context-aware chat; proposed actions are returned for confirmation, never executed.",
	},
	"ai.generateCompose": {
		summary: "Generate a compose file",
		description:
			"Drafts a docker-compose file from a prompt. Review before saving — it is not validated.",
		capability: ["ai.use"],
	},
	"mount.byApplication": {
		summary: "List mounts of an application",
		description: "Bind, volume and file mounts attached to an application.",
	},
	"mount.byCompose": {
		summary: "List mounts of a compose stack",
		description:
			"Bind, volume and file mounts attached to a compose stack. Each row names the service of the stack it mounts into.",
	},
	"mount.one": {
		summary: "Get one mount",
		description: "Mount type, source, target and file content.",
	},
	"mount.create": {
		summary: "Create a mount",
		description:
			"Bind, named volume or file mount. Pass either applicationId or composeId; a compose mount also needs serviceName, because a stack has more than one container. File mounts are written to the service's config directory on deploy.",
		capability: ["service.write", "secrets.write"],
		instanceAdmin: true,
	},
	"mount.update": {
		summary: "Update a mount",
		description: "Applied on the next deploy or reload.",
		capability: ["service.write", "secrets.write"],
		instanceAdmin: true,
	},
	"mount.delete": {
		summary: "Delete a mount",
		description: "The underlying volume or host path is not removed.",
		capability: ["service.write"],
	},
	"port.byApplication": {
		summary: "List published ports of a service",
		description: "Swarm published ports with protocol and publish mode.",
	},
	"port.one": {
		summary: "Get one published port",
		description: "Published and target port, protocol and mode.",
	},
	"port.create": {
		summary: "Publish a port",
		description: "TCP or UDP, ingress or host mode. Applied on the next deploy.",
		capability: ["service.write"],
	},
	"port.update": {
		summary: "Update a published port",
		description: "Applied on the next deploy.",
		capability: ["service.write"],
	},
	"port.delete": {
		summary: "Unpublish a port",
		description: "Applied on the next deploy.",
		capability: ["service.write"],
	},
	"redirect.byApplication": {
		summary: "List redirects of an application",
		description: "Traefik redirectRegex middlewares attached to the application's routers.",
	},
	"redirect.byCompose": {
		summary: "List redirects of a compose service",
		description: "Traefik redirectRegex middlewares attached to the stack's routers.",
	},
	"redirect.one": {
		summary: "Get one redirect",
		description: "Regex, replacement and permanent flag.",
	},
	"redirect.create": {
		summary: "Create a redirect",
		description: "Adds a redirectRegex middleware and rewrites the Traefik config.",
		capability: ["service.write"],
	},
	"redirect.update": {
		summary: "Update a redirect",
		description: "Rewrites the Traefik config immediately.",
		capability: ["service.write"],
	},
	"redirect.delete": {
		summary: "Delete a redirect",
		description: "Rewrites the Traefik config immediately.",
		capability: ["service.write"],
	},
	"security.byApplication": {
		summary: "List basic-auth users of an application",
		description: "HTTP basic-auth credentials guarding the application's routers.",
	},
	"security.byCompose": {
		summary: "List basic-auth users of a compose service",
		description: "HTTP basic-auth credentials guarding the stack's routers.",
	},
	"security.one": {
		summary: "Get one basic-auth user",
		description: "Username only; the password hash is not returned.",
	},
	"security.create": {
		summary: "Add a basic-auth user",
		description: "Adds a Traefik basicAuth middleware entry; the password is hashed with bcrypt.",
		capability: ["service.write", "secrets.write"],
	},
	"security.update": {
		summary: "Update a basic-auth user",
		description: "Rotates the password and rewrites the Traefik config.",
		capability: ["service.write", "secrets.write"],
	},
	"security.delete": {
		summary: "Remove a basic-auth user",
		description: "Removing the last user drops the middleware entirely.",
		capability: ["service.write"],
	},
	"github.createAppManifest": {
		summary: "Start the GitHub App manifest flow",
		description:
			"Returns the manifest and state used to create a GitHub App that Nixploy then installs.",
		capability: ["git_providers.manage"],
	},
	"github.syncInstallation": {
		summary: "Sync a GitHub App installation",
		description: "Refreshes the installation id and the repositories the app can see.",
		capability: ["git_providers.manage"],
	},
	"gitlab.testConnection": {
		summary: "Test a GitLab connection",
		description: "Calls the GitLab API with the stored token.",
		capability: ["git_providers.manage"],
	},
	"gitea.testConnection": {
		summary: "Test a Gitea connection",
		description: "Calls the Gitea API with the stored token.",
		capability: ["git_providers.manage"],
	},
	"gitea.revealWebhookSecret": {
		summary: "Reveal a Gitea webhook secret",
		description: "Returns the secret so it can be re-entered in the provider's webhook settings.",
		capability: ["git_providers.manage"],
	},
	"bitbucket.testConnection": {
		summary: "Test a Bitbucket connection",
		description: "Calls the Bitbucket API with the stored app password.",
		capability: ["git_providers.manage"],
	},
	"bitbucket.revealWebhookSecret": {
		summary: "Reveal a Bitbucket webhook secret",
		description: "Returns the secret so it can be re-entered in the provider's webhook settings.",
		capability: ["git_providers.manage"],
	},

	...databaseDocs("postgres", "PostgreSQL"),
	...databaseDocs("mysql", "MySQL"),
	...databaseDocs("mariadb", "MariaDB"),
	...databaseDocs("mongo", "MongoDB"),
	...databaseDocs("redis", "Redis"),
	...gitProviderDocs("github", "GitHub"),
	...gitProviderDocs("gitlab", "GitLab"),
	...gitProviderDocs("gitea", "Gitea"),
	...gitProviderDocs("bitbucket", "Bitbucket"),
};

export const procedureDocs: Readonly<Record<string, ProcedureDoc>> = docs;

/**
 * Procedures without a docs entry are tolerated only up to this count, so the
 * documented surface can never shrink silently. Lower it when you document
 * more; `openapi.test.ts` fails when the real number exceeds it.
 */
export const MAX_UNDOCUMENTED_PROCEDURES = 0;

export function procedureDoc(path: string): ProcedureDoc | undefined {
	return procedureDocs[path];
}

/** Every procedure path this file documents, sorted. */
export function documentedProcedures(): string[] {
	return Object.keys(procedureDocs).sort();
}
