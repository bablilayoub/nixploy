import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList, printRecord, printResult } from "../utils/output.js";

/**
 * Deployment history, log streaming, cancellation and rollback.
 *
 * Logs are followed by polling `deployment.getLogs` with a byte offset rather
 * than over the panel's WebSocket: the REST surface is the only thing an API
 * key can authenticate against, polling survives proxies that buffer, and the
 * procedure already returns `done` when the worker finalizes the row.
 */

export const LOG_POLL_INTERVAL_MS = 1_500;

interface LogChunk {
	deploymentId: string;
	status: string;
	log: string;
	offset: number;
	done: boolean;
}

export interface FollowOptions {
	deploymentId?: string;
	applicationId?: string;
	composeId?: string;
	follow: boolean;
	/** Stop after this many polls (tests); unlimited when omitted. */
	maxPolls?: number;
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Print the build log from `offset` 0, following until the deployment
 * finishes. Returns the last chunk so callers can report the final status.
 */
export async function followDeploymentLogs(options: FollowOptions): Promise<LogChunk | null> {
	if (!options.deploymentId && !options.applicationId && !options.composeId) {
		throw usageError("Provide a deployment ID, --application-id, or --compose-id");
	}
	const sleep = options.sleep ?? defaultSleep;
	let offset = 0;
	let deploymentId = options.deploymentId;
	let polls = 0;

	for (;;) {
		const chunk = await apiGet<LogChunk>("deployment.getLogs", {
			deploymentId,
			applicationId: deploymentId ? undefined : options.applicationId,
			composeId: deploymentId ? undefined : options.composeId,
			offset,
		});
		deploymentId = chunk.deploymentId;
		if (chunk.log) {
			process.stdout.write(chunk.log);
		}
		offset = chunk.offset;
		polls += 1;
		if (!options.follow || chunk.done) {
			return chunk;
		}
		if (options.maxPolls !== undefined && polls >= options.maxPolls) {
			return chunk;
		}
		await sleep(LOG_POLL_INTERVAL_MS);
	}
}

const DEPLOYMENT_COLUMNS = [
	"deploymentId",
	"title",
	"status",
	"createdAt",
	"startedAt",
	"finishedAt",
];

export function deploymentCommand(): Command {
	const deployment = new Command("deployment").description(
		"Deployment history, logs, cancel and rollback",
	);

	addOutputOptions(
		deployment
			.command("list")
			.description("List deployments of an application, a compose service, or a project")
			.option("--application-id <id>", "Application ID")
			.option("--compose-id <id>", "Compose ID")
			.option("--project-id <id>", "Project ID")
			.option("--limit <n>", "Rows to return"),
	).action(
		async (options: {
			applicationId?: string;
			composeId?: string;
			projectId?: string;
			limit?: string;
		}) => {
			const limit = options.limit ? Number(options.limit) : undefined;
			if (limit !== undefined && !Number.isFinite(limit)) {
				throw usageError("--limit expects a number");
			}
			const targets = [options.applicationId, options.composeId, options.projectId].filter(Boolean);
			if (targets.length !== 1) {
				throw usageError("Provide exactly one of --application-id, --compose-id, --project-id");
			}
			const [procedure, input] = options.applicationId
				? (["deployment.byApplication", { applicationId: options.applicationId, limit }] as const)
				: options.composeId
					? (["deployment.byCompose", { composeId: options.composeId, limit }] as const)
					: (["deployment.byProject", { projectId: options.projectId, limit }] as const);
			const page = await apiGet<{ deployments: unknown[] }>(procedure, input);
			printList(page.deployments, DEPLOYMENT_COLUMNS);
		},
	);

	addOutputOptions(
		deployment
			.command("recent")
			.description("Most recent deployments across the organization")
			.option("--limit <n>", "Rows to return"),
	).action(async (options: { limit?: string }) => {
		const page = await apiGet<{ deployments: unknown[] }>("deployment.recent", {
			limit: options.limit ? Number(options.limit) : undefined,
		});
		printList(page.deployments, [...DEPLOYMENT_COLUMNS, "appName"]);
	});

	addOutputOptions(
		deployment
			.command("get")
			.description("Status of one deployment (without its log body)")
			.argument("<deploymentId>", "Deployment ID"),
	).action(async (deploymentId: string) => {
		const chunk = await apiGet<LogChunk>("deployment.getLogs", { deploymentId, offset: 0 });
		printRecord({
			deploymentId: chunk.deploymentId,
			status: chunk.status,
			done: chunk.done,
			logBytes: chunk.offset,
		});
	});

	deployment
		.command("logs")
		.description("Print (and optionally follow) a deployment's build log")
		.argument("[deploymentId]", "Deployment ID (or use --application-id / --compose-id)")
		.option("--application-id <id>", "Latest deployment of this application")
		.option("--compose-id <id>", "Latest deployment of this compose service")
		.option("-f, --follow", "Follow until the deployment finishes")
		.action(
			async (
				deploymentId: string | undefined,
				options: { applicationId?: string; composeId?: string; follow?: boolean },
			) => {
				await followDeploymentLogs({
					deploymentId,
					applicationId: options.applicationId,
					composeId: options.composeId,
					follow: Boolean(options.follow),
				});
			},
		);

	addOutputOptions(
		deployment
			.command("cancel")
			.description("Request cancellation of a queued or running deployment")
			.argument("<deploymentId>", "Deployment ID"),
	).action(async (deploymentId: string) => {
		const result = await apiPost("application.cancelDeployment", { deploymentId });
		printResult(result, "Cancellation requested.");
	});

	addOutputOptions(
		deployment
			.command("rollbacks")
			.description("List the rollback points kept for an application (newest first)")
			.argument("<applicationId>", "Application ID"),
	).action(async (applicationId: string) => {
		const rows = await apiGet("rollback.all", { applicationId });
		printList(rows, ["rollbackId", "image", "version", "createdAt"]);
	});

	addOutputOptions(
		deployment
			.command("rollback")
			.description("Roll an application back to a stored image pin")
			.argument("<applicationId>", "Application ID")
			.requiredOption("--rollback-id <id>", "Rollback point (see `deployment rollbacks`)"),
	).action(async (applicationId: string, options: { rollbackId: string }) => {
		const result = await apiPost("application.rollback", {
			applicationId,
			rollbackId: options.rollbackId,
		});
		printResult(result, "Rollback queued.");
	});

	return deployment;
}

/**
 * Backwards-compatible `nixploy deploy logs …` from CLI 0.1. Hidden from help;
 * `nixploy deployment logs` is the documented spelling.
 */
export function legacyDeployCommand(): Command {
	const deploy = new Command("deploy").description("Deprecated alias for `deployment`");
	deploy
		.command("logs")
		.description("Deprecated: use `nixploy deployment logs`")
		.argument("[deploymentId]", "Deployment ID")
		.option("--application-id <id>", "Latest deployment of this application")
		.option("-f, --follow", "Follow log output until the deployment finishes")
		.action(
			async (
				deploymentId: string | undefined,
				options: { applicationId?: string; follow?: boolean },
			) => {
				await followDeploymentLogs({
					deploymentId,
					applicationId: options.applicationId,
					follow: Boolean(options.follow),
				});
			},
		);
	return deploy;
}
