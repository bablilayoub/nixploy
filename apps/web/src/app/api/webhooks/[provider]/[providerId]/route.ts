import {
	type GitWebhookProvider,
	type GitWebhookResult,
	handleGitWebhook,
	handlePreviewWebhookForApplication,
	queueWebhookDeployment,
	WebhookIgnored,
	WebhookUnauthorized,
} from "@nixploy/server/modules/git/webhook-handler";
import { clientIpFromRequest, takeRateLimitToken } from "@nixploy/server/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = new Set<GitWebhookProvider>(["github", "gitlab", "bitbucket", "gitea"]);
const MAX_BODY_BYTES = 1_048_576;

interface RouteParams {
	params: Promise<{ provider: string; providerId: string }>;
}

/** Read the request body with a hard byte cap (do not rely on Content-Length alone). */
async function readBodyLimited(req: Request, limit: number): Promise<string | Response> {
	const contentLength = req.headers.get("content-length");
	if (contentLength != null) {
		const declared = Number(contentLength);
		if (!Number.isFinite(declared) || declared < 0) {
			return Response.json({ message: "Invalid Content-Length" }, { status: 400 });
		}
		if (declared > limit) {
			return Response.json({ message: "Payload too large" }, { status: 413 });
		}
	}
	if (!req.body) return "";
	const reader = req.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel();
			return Response.json({ message: "Payload too large" }, { status: 413 });
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8").decode(merged);
}

/**
 * Git provider webhooks: POST /api/webhooks/<provider>/<providerId>. The
 * delivery's signature/token is verified against the named provider row
 * (see packages/server modules/git/webhook-handler), then:
 * - push/tag → every matching auto-deploy application is redeployed
 * - pull_request → every matching preview-enabled application creates,
 *   redeploys, or deletes a preview deployment
 */
export async function POST(req: Request, { params }: RouteParams) {
	const { provider, providerId } = await params;
	if (!PROVIDERS.has(provider as GitWebhookProvider)) {
		return Response.json({ message: `Unknown provider: ${provider}` }, { status: 404 });
	}

	const ip = clientIpFromRequest(req);
	// Rate-limit by provider id (unspoofable) and by IP (when trusted proxy is set).
	if (
		!takeRateLimitToken(`webhook:${provider}:${providerId}`, { windowMs: 60_000, max: 120 }) ||
		!takeRateLimitToken(`webhook:${provider}:${providerId}:${ip}`, { windowMs: 60_000, max: 60 })
	) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	// Signature verification needs the exact raw body and lowercase headers.
	const rawBodyOrError = await readBodyLimited(req, MAX_BODY_BYTES);
	if (rawBodyOrError instanceof Response) return rawBodyOrError;
	const rawBody = rawBodyOrError;
	const headers: Record<string, string> = {};
	req.headers.forEach((value, key) => {
		headers[key] = value;
	});

	let result: GitWebhookResult;
	try {
		result = await handleGitWebhook(provider as GitWebhookProvider, headers, rawBody, providerId);
	} catch (error) {
		if (error instanceof WebhookUnauthorized) {
			return Response.json({ message: error.message }, { status: 401 });
		}
		if (error instanceof WebhookIgnored) {
			return Response.json({ ignored: true, message: error.message }, { status: 202 });
		}
		throw error;
	}

	if (result.type === "pull_request") {
		const previews: Array<{
			applicationId: string;
			action: string;
			previewDeploymentId?: string;
			deploymentId?: string;
		}> = [];
		for (const applicationId of result.applicationIds) {
			const outcome = await handlePreviewWebhookForApplication(applicationId, result);
			previews.push({ applicationId, ...outcome });
		}
		return Response.json({
			branch: result.branch,
			type: result.type,
			pullRequest: result.pullRequest,
			applicationIds: result.applicationIds,
			previews,
		});
	}

	const title = `Webhook: ${result.type} to ${result.branch}`;
	const deploymentIds: string[] = [];
	for (const applicationId of result.applicationIds) {
		deploymentIds.push(await queueWebhookDeployment(applicationId, title));
	}

	return Response.json({
		branch: result.branch,
		type: result.type,
		applicationIds: result.applicationIds,
		deploymentIds,
	});
}
