import { readFile } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, compose, deployments, domains } from "../../db/schema";
import { redactSensitiveText } from "../../utils/public-url";
import { completeChat } from "./client";
import { writeCachedExplanation } from "./explanation-cache";
import { validateComposeYaml } from "./generate-compose";
import { getAiSettings } from "./settings";

const MAX_LOG_CHARS = 24_000;

export interface ExplainFailureResult {
	summary: string;
	rootCause: string;
	steps: string[];
	suggestedPatch: string | null;
	model: string;
	deploymentId: string;
}

function collectEnvSecrets(...blobs: Array<string | null | undefined>): string[] {
	const secrets: string[] = [];
	for (const blob of blobs) {
		if (!blob) continue;
		for (const line of blob.split("\n")) {
			const idx = line.indexOf("=");
			if (idx > 0) {
				const value = line.slice(idx + 1).trim();
				if (value.length >= 6) secrets.push(value);
			}
		}
	}
	return secrets;
}

function redactSecrets(text: string, secrets: string[]): string {
	return redactSensitiveText(text, secrets);
}

function redactComposeYamlForLlm(yaml: string, secrets: string[]): string {
	const scrubbed = redactSecrets(yaml, secrets);
	// Drop obvious inline secret assignments from compose env blocks.
	return scrubbed
		.replace(
			/^(\s*(?:-\s*)?(?:PASSWORD|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|DATABASE_URL)[^=:\n]*)[=:][^\n]*$/gim,
			"$1=[REDACTED]",
		)
		.slice(0, 6_000);
}

async function loadDeploymentForOrg(deploymentId: string, organizationId: string) {
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
		with: {
			application: {
				with: {
					environment: { with: { project: true } },
				},
			},
			compose: {
				with: {
					environment: { with: { project: true } },
				},
			},
		},
	});
	if (!deployment) return null;

	const appOrg = deployment.application?.environment.project.organizationId;
	const composeOrg = deployment.compose?.environment.project.organizationId;
	const orgId = appOrg ?? composeOrg;
	if (orgId !== organizationId) return null;
	return deployment;
}

export async function explainDeploymentFailure(
	deploymentId: string,
	organizationId: string,
): Promise<ExplainFailureResult> {
	const settings = await getAiSettings();
	const deployment = await loadDeploymentForOrg(deploymentId, organizationId);
	if (!deployment) {
		throw new Error("Deployment not found");
	}
	if (deployment.status !== "error" && deployment.status !== "done") {
		// Allow explain on error primarily; also allow done for post-mortems of flaky runs
	}
	if (deployment.status === "running") {
		throw new Error("Deployment is still running");
	}

	let logTail = "";
	if (deployment.logPath) {
		try {
			const raw = await readFile(deployment.logPath, "utf8");
			logTail = raw.length > MAX_LOG_CHARS ? raw.slice(-MAX_LOG_CHARS) : raw;
		} catch {
			logTail = "(log file unavailable)";
		}
	}

	const secrets: string[] = [];
	let buildType = "unknown";
	let serviceName = "unknown";
	let serviceKind: "application" | "compose" = "application";

	if (deployment.application) {
		serviceName = deployment.application.name;
		buildType = deployment.application.buildType;
		serviceKind = "application";
		secrets.push(
			...collectEnvSecrets(
				deployment.application.env,
				deployment.application.environment?.env,
				deployment.application.environment?.project?.env,
				deployment.application.buildArgs,
			),
		);
	} else if (deployment.compose) {
		serviceName = deployment.compose.name;
		buildType = "compose";
		serviceKind = "compose";
		secrets.push(
			...collectEnvSecrets(
				deployment.compose.env,
				deployment.compose.environment?.env,
				deployment.compose.environment?.project?.env,
			),
		);
	}

	const safeLog = redactSecrets(logTail, secrets);
	const errorMessage = deployment.errorMessage
		? redactSecrets(deployment.errorMessage, secrets)
		: null;

	const system = `You are Nixploy Deploy Copilot, an expert at debugging Docker/Swarm PaaS deployments.
Respond in JSON only with this shape:
{"summary":"one paragraph","rootCause":"short cause","steps":["actionable step",...],"suggestedPatch":"optional dockerfile/compose/env hint or null"}
Be concrete. Prefer fixes the user can apply in Nixploy (build type, Dockerfile, env, healthcheck, resources).
When the fix is environment variables, put ONLY dotenv KEY=VALUE lines in suggestedPatch (no prose) so Nixploy can apply them automatically.
Never invent secrets.`;

	const user = `Service: ${serviceName} (${serviceKind})
Build type: ${buildType}
Deployment status: ${deployment.status}
Error message: ${errorMessage ?? "(none)"}

Log tail:
\`\`\`
${safeLog}
\`\`\``;

	const completion = await completeChat(settings, [
		{ role: "system", content: system },
		{ role: "user", content: user },
	]);

	let parsed: {
		summary?: string;
		rootCause?: string;
		steps?: string[];
		suggestedPatch?: string | null;
	};
	try {
		const jsonMatch = completion.content.match(/\{[\s\S]*\}/);
		parsed = JSON.parse(jsonMatch?.[0] ?? completion.content) as typeof parsed;
	} catch {
		parsed = {
			summary: completion.content,
			rootCause: "See summary",
			steps: [],
			suggestedPatch: null,
		};
	}

	return {
		summary: parsed.summary?.trim() || completion.content,
		rootCause: parsed.rootCause?.trim() || "Unknown",
		steps: Array.isArray(parsed.steps) ? parsed.steps.map(String) : [],
		suggestedPatch: parsed.suggestedPatch?.trim() || null,
		model: completion.model,
		deploymentId,
	};
}

/** Explain a failure and persist the result next to the deploy log. */
export async function explainAndCacheDeploymentFailure(
	deploymentId: string,
	organizationId: string,
): Promise<ExplainFailureResult> {
	const result = await explainDeploymentFailure(deploymentId, organizationId);
	const deployment = await db.query.deployments.findFirst({
		where: eq(deployments.deploymentId, deploymentId),
	});
	if (deployment?.logPath) {
		await writeCachedExplanation(deployment.logPath, result);
	}
	return result;
}

export type ProposedAction =
	| { type: "redeploy"; label: string }
	| { type: "deploy"; label: string }
	| { type: "start"; label: string }
	| { type: "stop"; label: string }
	| { type: "applyComposeDraft"; label: string; composeFile: string };

const ACTION_TYPES = new Set(["redeploy", "deploy", "start", "stop", "applyComposeDraft"]);

function parseProposedActions(raw: unknown): ProposedAction[] {
	if (!Array.isArray(raw)) return [];
	const out: ProposedAction[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const action = item as Record<string, unknown>;
		const type = action.type;
		const label = action.label;
		if (typeof type !== "string" || !ACTION_TYPES.has(type) || typeof label !== "string") {
			continue;
		}
		if (type === "applyComposeDraft") {
			const composeFile = action.composeFile;
			if (typeof composeFile !== "string" || composeFile.trim().length < 8) continue;
			const validation = validateComposeYaml(composeFile);
			if (!validation.ok) continue;
			out.push({ type, label, composeFile: composeFile.trim() });
			continue;
		}
		out.push({ type: type as "redeploy" | "deploy" | "start" | "stop", label });
	}
	return out;
}

export type CopilotTarget =
	| { type: "application"; applicationId: string }
	| { type: "compose"; composeId: string };

/** Lightweight org-scoped chat about an application or compose service. */
export async function chatAboutService(
	target: CopilotTarget,
	organizationId: string,
	messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ reply: string; model: string; proposedActions: ProposedAction[] }> {
	const settings = await getAiSettings();

	let system: string;
	if (target.type === "application") {
		const app = await db.query.applications.findFirst({
			where: eq(applications.applicationId, target.applicationId),
			with: {
				environment: { with: { project: true } },
			},
		});
		if (!app || app.environment.project.organizationId !== organizationId) {
			throw new Error("Application not found");
		}

		const appDomains = await db
			.select({ host: domains.host })
			.from(domains)
			.where(eq(domains.applicationId, target.applicationId));

		const recent = await db.query.deployments.findMany({
			where: eq(deployments.applicationId, target.applicationId),
			orderBy: [desc(deployments.createdAt)],
			limit: 5,
		});

		const context = `Application "${app.name}" (${app.appName})
Status: ${app.status}
Source: ${app.sourceType}
Build: ${app.buildType}
Replicas: ${app.replicas}
Domains: ${appDomains.map((d) => d.host).join(", ") || "(none)"}
Recent deploys: ${recent.map((d) => `${d.status}@${d.createdAt.toISOString()}`).join("; ") || "(none)"}
CPU limit: ${app.cpuLimit ?? "unset"}, Memory limit: ${app.memoryLimit ?? "unset"}`;

		system = `You are Nixploy Deploy Copilot helping with an application.
Respond in JSON only:
{"reply":"markdown-friendly answer","proposedActions":[{"type":"redeploy|deploy|start|stop","label":"short confirm button label"}]}
proposedActions may be empty. Never claim you already applied a mutation — the UI confirms first.
Be concise. Context:
${context}`;
	} else {
		const row = await db.query.compose.findFirst({
			where: eq(compose.composeId, target.composeId),
			with: {
				environment: { with: { project: true } },
			},
		});
		if (!row || row.environment.project.organizationId !== organizationId) {
			throw new Error("Compose service not found");
		}

		const composeDomains = await db
			.select({ host: domains.host, serviceName: domains.serviceName })
			.from(domains)
			.where(eq(domains.composeId, target.composeId));

		const recent = await db.query.deployments.findMany({
			where: eq(deployments.composeId, target.composeId),
			orderBy: [desc(deployments.createdAt)],
			limit: 5,
		});

		const secrets = collectEnvSecrets(row.env, row.environment?.env, row.environment?.project?.env);
		const fileSnippet =
			redactComposeYamlForLlm(row.composeFile ?? "", secrets) ||
			"(empty — help the operator draft one)";

		const context = `Compose "${row.name}" (${row.appName})
Status: ${row.status}
Type: ${row.composeType}
Source: ${row.sourceType}
Domains: ${
			composeDomains
				.map((d) => `${d.host}${d.serviceName ? `→${d.serviceName}` : ""}`)
				.join(", ") || "(none)"
		}
Recent deploys: ${recent.map((d) => `${d.status}@${d.createdAt.toISOString()}`).join("; ") || "(none)"}
Current compose file:
\`\`\`yaml
${fileSnippet}
\`\`\``;

		system = `You are Nixploy Deploy Copilot helping with a Docker Compose / Swarm stack.
Respond in JSON only:
{"reply":"markdown-friendly answer","proposedActions":[{"type":"redeploy|deploy|start|stop|applyComposeDraft","label":"short confirm button label","composeFile":"…only when type is applyComposeDraft…"}]}
When the operator asks to generate or rewrite the compose file, include one applyComposeDraft action with a full valid docker-compose YAML in composeFile (services: required). Do not wrap YAML in markdown fences inside composeFile.
proposedActions may be empty. Never claim you already saved or deployed — the UI confirms first.
Be concise. Context:
${context}`;
	}

	const completion = await completeChat(settings, [
		{ role: "system", content: system },
		...messages.map((m) => ({ role: m.role, content: m.content })),
	]);

	let parsed: { reply?: string; proposedActions?: unknown };
	try {
		const jsonMatch = completion.content.match(/\{[\s\S]*\}/);
		parsed = JSON.parse(jsonMatch?.[0] ?? completion.content) as typeof parsed;
	} catch {
		parsed = { reply: completion.content, proposedActions: [] };
	}

	return {
		reply: parsed.reply?.trim() || completion.content,
		model: completion.model,
		proposedActions: parseProposedActions(parsed.proposedActions),
	};
}

/** @deprecated Prefer chatAboutService — kept for call-site clarity on apps. */
export async function chatAboutApplication(
	applicationId: string,
	organizationId: string,
	messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
	return chatAboutService({ type: "application", applicationId }, organizationId, messages);
}
