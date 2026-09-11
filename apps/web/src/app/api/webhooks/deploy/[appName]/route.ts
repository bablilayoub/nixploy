import { findApplicationByAppNameForUser } from "@nixploy/server/modules/application/org";
import { authenticateApiKey } from "@nixploy/server/modules/auth/api-key";
import { queueWebhookDeployment } from "@nixploy/server/modules/git/webhook-handler";
import { hasCapability } from "@nixploy/server/modules/projects/index";
import {
	clientIpFromRequest,
	takeIpRateLimitToken,
	takeRateLimitToken,
} from "@nixploy/server/utils/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
	params: Promise<{ appName: string }>;
}

/**
 * Generic deploy webhook: POST /api/webhooks/deploy/<appName> authenticated
 * with an API key (`x-api-key` header or `Authorization: Bearer`). Triggers
 * a redeploy of the application — usable from any CI system that can POST
 * with a header. The application must belong to an organization the key
 * owner is a member of, and the owner must have `service.deploy`.
 */
export async function POST(req: Request, { params }: RouteParams) {
	// Per-IP flood guard (widened when no trusted proxy reveals the IP), then a
	// per-key-owner bucket so one busy CI runner cannot 429 everyone else.
	const ip = clientIpFromRequest(req);
	if (!takeIpRateLimitToken("deploy-webhook", ip, { windowMs: 60_000, max: 30 })) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	const authenticated = await authenticateApiKey(req);
	if (authenticated instanceof Response) return authenticated;
	if (
		!takeRateLimitToken(`deploy-webhook:user:${authenticated.userId}`, {
			windowMs: 60_000,
			max: 30,
		})
	) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	const { appName } = await params;
	const application = await findApplicationByAppNameForUser(appName, authenticated.userId);
	if (!application) {
		return Response.json({ message: `Application not found: ${appName}` }, { status: 404 });
	}

	const organizationId = application.environment.project.organizationId;
	const canDeploy = await hasCapability(authenticated.userId, organizationId, "service.deploy");
	if (!canDeploy) {
		// Same 404 as cross-tenant misses — do not reveal the app exists.
		return Response.json({ message: `Application not found: ${appName}` }, { status: 404 });
	}

	// An API-key caller, not a provider push: recorded as `api` by the key owner.
	const deploymentId = await queueWebhookDeployment(
		application.applicationId,
		"Webhook: manual deploy trigger",
		{ trigger: "api", triggeredBy: authenticated.userId },
	);
	return Response.json({
		applicationId: application.applicationId,
		deploymentId,
	});
}
