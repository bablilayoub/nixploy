import type { appRouter } from "../../trpc/root";

/**
 * MCP resources: two things an agent wants to *attach* rather than call.
 *
 * `nixploy://service/{id}` is a service's current state and
 * `nixploy://deployment/{id}/log` is a build log. Both are the same data the
 * tools return; a resource exists so a host can pin one into the context and
 * re-read it, instead of re-issuing a tool call each turn.
 *
 * Same boundary as the tools: the read goes through the caller, so the
 * organization scope and capability checks apply. A URI is not an authority —
 * an id from another tenant answers "not found" exactly as it does everywhere
 * else.
 */

type Caller = ReturnType<typeof appRouter.createCaller>;

/** Keep a log attachment inside an agent's context window. */
const MAX_LOG_CHARS = 16_000;

export const SERVICE_RESOURCE_TEMPLATE = "nixploy://service/{applicationId}";
export const DEPLOYMENT_LOG_RESOURCE_TEMPLATE = "nixploy://deployment/{deploymentId}/log";

/** Current state of one application, as JSON. */
export async function readServiceResource(
	caller: Caller,
	applicationId: string,
): Promise<{ text: string; mimeType: string }> {
	const summary = await caller.application.one({ applicationId });
	const events = await caller.observability
		.serviceEvents({ serviceType: "application", serviceId: applicationId, limit: 10 })
		.then((page) => page.events)
		.catch(() => []);
	return {
		mimeType: "application/json",
		text: JSON.stringify(
			{
				applicationId: summary.applicationId,
				name: summary.name,
				appName: summary.appName,
				status: summary.status,
				sourceType: summary.sourceType,
				buildType: summary.buildType,
				recentEvents: events.map((event) => ({
					kind: event.kind,
					severity: event.severity,
					title: event.title,
					occurredAt: event.occurredAt,
				})),
			},
			null,
			2,
		),
	};
}

/** Tail of one deployment's build log, as plain text. */
export async function readDeploymentLogResource(
	caller: Caller,
	deploymentId: string,
): Promise<{ text: string; mimeType: string }> {
	const chunk = await caller.deployment.getLogs({ deploymentId, offset: 0 });
	const truncated = chunk.log.length > MAX_LOG_CHARS;
	return {
		mimeType: "text/plain",
		text: truncated
			? `[truncated to the last ${MAX_LOG_CHARS} characters]\n${chunk.log.slice(-MAX_LOG_CHARS)}`
			: chunk.log,
	};
}
