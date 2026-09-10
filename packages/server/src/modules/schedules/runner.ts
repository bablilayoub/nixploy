import { eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose } from "../../db/schema";
import {
	execAsync,
	execAsyncRemote,
	execAsyncWithStdin,
	remoteCommandTimeoutMs,
} from "../../utils/exec";

/**
 * Executes a schedule's command/script against its target:
 * - `application` / `compose`: inside a running service container (docker exec,
 *   locally or over SSH when the service is placed on a remote server)
 * - `server`: on a remote managed server over SSH
 * - `nixploy-server`: inside the Nixploy container itself (the local process)
 */

export type ScheduleTarget = {
	scheduleType: "application" | "compose" | "server" | "nixploy-server";
	appName?: string | null;
	applicationId?: string | null;
	composeId?: string | null;
	serverId?: string | null;
	shellType: "bash" | "sh";
	command: string;
	script?: string | null;
};

/** Wrap a string in single quotes for safe embedding in a remote shell. */
function shQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Inline scripts are streamed to the shell on stdin (`sh -s`) instead of
 * being base64-embedded in argv, which capped them at the kernel's
 * MAX_ARG_STRLEN and exposed them in `ps`.
 */
function buildInnerCommand(target: ScheduleTarget): string {
	return target.script ? `${target.shellType} -s` : target.command;
}

async function resolveAppName(target: ScheduleTarget): Promise<string> {
	// Prefer IDs over stored appName so a stale/tampered name cannot retarget exec.
	if (target.applicationId) {
		const app = await db.query.applications.findFirst({
			where: eq(applications.applicationId, target.applicationId),
		});
		if (app) return app.appName;
	}
	if (target.composeId) {
		const stack = await db.query.compose.findFirst({
			where: eq(compose.composeId, target.composeId),
		});
		if (stack) return stack.appName;
	}
	if (target.appName) return target.appName;
	throw new Error("Schedule has no appName and its target service could not be resolved");
}

async function resolveServiceServerId(target: ScheduleTarget): Promise<string | null> {
	if (target.applicationId) {
		const app = await db.query.applications.findFirst({
			where: eq(applications.applicationId, target.applicationId),
		});
		return app?.serverId ?? null;
	}
	if (target.composeId) {
		const stack = await db.query.compose.findFirst({
			where: eq(compose.composeId, target.composeId),
		});
		return stack?.serverId ?? null;
	}
	return null;
}

async function findContainerId(
	target: ScheduleTarget,
	appName: string,
	serverId: string | null,
): Promise<string> {
	// Exact Swarm / compose identity — never `name=` substring (that matches
	// sibling tenants like `api` vs `api-prod`).
	const filters =
		target.scheduleType === "compose"
			? [
					`--filter ${shQuote(`label=com.docker.compose.project=${appName}`)}`,
					`--filter ${shQuote(`label=com.docker.stack.namespace=${appName}`)}`,
				]
			: [`--filter ${shQuote(`label=com.docker.swarm.service.name=${appName}`)}`];

	for (const filter of filters) {
		const lookup = `docker ps -q ${filter} | head -n 1`;
		const output = serverId ? await execAsyncRemote(serverId, lookup) : await execAsync(lookup);
		const containerId = output.trim().split("\n")[0]?.trim();
		if (containerId) return containerId;
	}
	throw new Error(`No running container found for ${appName}`);
}

/**
 * Run the schedule's command against its target. Resolves with combined
 * stdout, rejects with the underlying exec error (stderr attached when the
 * failure happened on a remote server).
 */
export async function runScheduleCommand(target: ScheduleTarget): Promise<string> {
	const inner = buildInnerCommand(target);

	switch (target.scheduleType) {
		case "application":
		case "compose": {
			const [appName, serviceServerId] = await Promise.all([
				resolveAppName(target),
				resolveServiceServerId(target),
			]);
			const containerId = await findContainerId(target, appName, serviceServerId);
			if (target.script) {
				const dockerCmd = `docker exec -i ${shQuote(containerId)} ${target.shellType} -s`;
				return execAsyncWithStdin(dockerCmd, target.script, {
					serverId: serviceServerId,
					timeout: remoteCommandTimeoutMs(),
				});
			}
			const dockerCmd = `docker exec ${shQuote(containerId)} ${target.shellType} -c ${shQuote(inner)}`;
			return serviceServerId
				? execAsyncRemote(serviceServerId, dockerCmd)
				: execAsync(dockerCmd, { timeout: remoteCommandTimeoutMs() });
		}
		case "server": {
			if (!target.serverId) {
				throw new Error("Server schedule is missing serverId");
			}
			if (target.script) {
				return execAsyncWithStdin(inner, target.script, { serverId: target.serverId });
			}
			return execAsyncRemote(target.serverId, inner);
		}
		case "nixploy-server": {
			// Same hard timeout as remote commands: a hung command must not pin
			// the schedule's in-flight guard forever.
			if (target.script) {
				return execAsyncWithStdin(inner, target.script, { timeout: remoteCommandTimeoutMs() });
			}
			return execAsync(inner, { timeout: remoteCommandTimeoutMs() });
		}
	}
}
