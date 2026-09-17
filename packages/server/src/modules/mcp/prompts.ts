import { z } from "zod";

/**
 * MCP prompts: the two investigations people actually start.
 *
 * A prompt is a *plan*, not an answer — it tells the agent which of this
 * server's tools to use and in what order, so the first thing it does is read
 * the timeline rather than guess from a service name. Everything it can look
 * at still goes through the tools, which go through the routers, which enforce
 * the organization scope and the capabilities. A prompt grants nothing.
 */

export interface McpPromptDefinition {
	name: string;
	title: string;
	description: string;
	argsSchema: z.ZodRawShape;
	/** Renders the user-role message the agent starts from. */
	render: (args: Record<string, string | undefined>) => string;
}

export const mcpPrompts: McpPromptDefinition[] = [
	{
		name: "troubleshoot_service",
		title: "Troubleshoot a service",
		description:
			"Work out why a service is unhealthy, using the runtime summary and its event timeline before touching anything.",
		argsSchema: {
			service: z
				.string()
				.describe("Service name, appName or id — resolve it with list_services if unsure"),
		},
		render: ({ service }) =>
			[
				`Find out what is wrong with the service "${service}" on this Nixploy instance.`,
				"",
				"Work in this order and stop as soon as you can answer:",
				"1. `list_services` to resolve it to an id, if you were not given one.",
				"2. `get_service_runtime_summary` — stored status, Swarm task counts, domains,",
				"   the last deployments and the last timeline events, in one call.",
				"3. `get_service_events` with kinds ['oom_killed','task_failed','status_changed',",
				"   'config_changed'] — this is what answers \"why did it restart?\". An",
				"   out-of-memory kill or a config change shortly before the trouble started is",
				"   usually the whole story.",
				"4. Only if the events do not explain it: `get_service_logs`, and",
				"   `explain_last_failure` when the most recent deployment failed.",
				"",
				"Then report: what is wrong, what the evidence is (quote the event or log line,",
				"with its timestamp), and what you would change. Do not deploy, restart, stop or",
				"roll anything back — say what you recommend and let a human choose. If the",
				"evidence does not support a conclusion, say that instead of picking the most",
				"likely-sounding cause.",
			].join("\n"),
	},
	{
		name: "explain_failed_deploy",
		title: "Explain a failed deploy",
		description:
			"Diagnose the most recent failed deployment of a service: the step it died in, the log tail, and what changed around it.",
		argsSchema: {
			service: z.string().describe("Service name, appName or id"),
		},
		render: ({ service }) =>
			[
				`Explain why the last deployment of "${service}" failed.`,
				"",
				"1. `explain_last_failure` — it returns the failing pipeline step, the error, the",
				"   log tail and, when Deploy Copilot is configured, a cached diagnosis. Do not",
				"   pass `force` unless the cached explanation is clearly about a different",
				"   failure.",
				"2. `get_service_events` around that time — a config or environment change just",
				"   before a build starts failing is the most common cause, and the timeline",
				"   records who made it.",
				"3. `get_deployment_provenance` when the failure looks source-related, to see",
				"   which commit was actually built.",
				"",
				"Report the failing step, the specific error (quoted), the most likely cause, and",
				"the smallest change that would fix it. If the log does not actually support a",
				'cause, say so — a confident wrong diagnosis costs more than "I cannot tell from',
				'this log". Do not re-deploy to test a theory unless you are asked to.',
			].join("\n"),
	},
];
