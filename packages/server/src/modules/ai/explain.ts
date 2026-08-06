import { readFile } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { applications, deployments, domains } from "../../db/schema";
import { completeChat } from "./client";
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

function redactSecrets(text: string, secrets: string[]): string {
	let out = text;
	for (const secret of secrets) {
		if (secret.length < 6) continue;
		out = out.split(secret).join("[REDACTED]");
	}
	return out;
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
		if (deployment.application.env) {
			for (const line of deployment.application.env.split("\n")) {
				const idx = line.indexOf("=");
				if (idx > 0) secrets.push(line.slice(idx + 1).trim());
			}
		}
	} else if (deployment.compose) {
		serviceName = deployment.compose.name;
		buildType = "compose";
		serviceKind = "compose";
	}

	const safeLog = redactSecrets(logTail, secrets);
	const errorMessage = deployment.errorMessage
		? redactSecrets(deployment.errorMessage, secrets)
		: null;

	const system = `You are Nixploy Deploy Copilot, an expert at debugging Docker/Swarm PaaS deployments.
Respond in JSON only with this shape:
{"summary":"one paragraph","rootCause":"short cause","steps":["actionable step",...],"suggestedPatch":"optional dockerfile/compose/env hint or null"}
Be concrete. Prefer fixes the user can apply in Nixploy (build type, Dockerfile, env, healthcheck, resources). Never invent secrets.`;

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

export type ProposedAction =
	| { type: "redeploy"; label: string }
	| { type: "deploy"; label: string }
	| { type: "start"; label: string }
	| { type: "stop"; label: string };

/** Lightweight org-scoped chat about a service (mutations require UI confirm). */
export async function chatAboutApplication(
	applicationId: string,
	organizationId: string,
	messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ reply: string; model: string; proposedActions: ProposedAction[] }> {
	const settings = await getAiSettings();
	const app = await db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
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
		.where(eq(domains.applicationId, applicationId));

	const recent = await db.query.deployments.findMany({
		where: eq(deployments.applicationId, applicationId),
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

	const system = `You are Nixploy Deploy Copilot. Help the operator manage this application.
Respond in JSON only:
{"reply":"markdown-friendly answer","proposedActions":[{"type":"redeploy|deploy|start|stop","label":"short confirm button label"}]}
proposedActions may be empty. Never claim you already applied a mutation — the UI confirms first.
Be concise. Context:
${context}`;

	const completion = await completeChat(settings, [
		{ role: "system", content: system },
		...messages.map((m) => ({ role: m.role, content: m.content })),
	]);

	let parsed: { reply?: string; proposedActions?: ProposedAction[] };
	try {
		const jsonMatch = completion.content.match(/\{[\s\S]*\}/);
		parsed = JSON.parse(jsonMatch?.[0] ?? completion.content) as typeof parsed;
	} catch {
		parsed = { reply: completion.content, proposedActions: [] };
	}

	const allowed = new Set(["redeploy", "deploy", "start", "stop"]);
	const proposedActions = (parsed.proposedActions ?? []).filter(
		(action): action is ProposedAction =>
			Boolean(action) &&
			typeof action === "object" &&
			allowed.has((action as ProposedAction).type) &&
			typeof (action as ProposedAction).label === "string",
	);

	return {
		reply: parsed.reply?.trim() || completion.content,
		model: completion.model,
		proposedActions,
	};
}
