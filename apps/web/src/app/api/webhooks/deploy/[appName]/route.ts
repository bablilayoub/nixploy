import { buildApiKeyContext } from "@nixploy/server/lib/api-key-context";
import { findApplicationByAppNameForUser } from "@nixploy/server/modules/application/org";
import {
	isTwoFactorGateBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE,
} from "@nixploy/server/modules/auth/two-factor-gate";
import { queueWebhookDeployment } from "@nixploy/server/modules/git/webhook-handler";
import { hasCapability, runWithCapabilityScope } from "@nixploy/server/modules/projects/index";
import {
	clientIpFromRequest,
	takeIpRateLimitToken,
	takeRateLimitToken,
} from "@nixploy/server/utils/rate-limit";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

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
 *
 * Authentication goes through `buildApiKeyContext` (not the bare
 * `authenticateApiKey`) so this route gets the same treatment as REST and
 * MCP: key scopes, the key's organization binding, per-key rate limits — and
 * the org 2FA gate, which this route used to skip (security audit 2.3).
 */
export async function POST(req: Request, { params }: RouteParams) {
	// Per-IP flood guard (widened when no trusted proxy reveals the IP), then a
	// per-key-owner bucket so one busy CI runner cannot 429 everyone else.
	const ip = clientIpFromRequest(req);
	if (!takeIpRateLimitToken("deploy-webhook", ip, { windowMs: 60_000, max: 30 })) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	let ctx: Awaited<ReturnType<typeof buildApiKeyContext>>;
	try {
		ctx = await buildApiKeyContext(req, { bucket: "deploy-webhook-key", allowBearer: true });
	} catch (error) {
		if (error instanceof TRPCError) {
			return Response.json(
				{ message: error.message },
				{ status: getHTTPStatusCodeFromError(error) },
			);
		}
		throw error;
	}

	const userId = ctx.session?.user.id;
	if (!userId) {
		return Response.json({ message: "Invalid or expired API key" }, { status: 401 });
	}
	if (
		!takeRateLimitToken(`deploy-webhook:user:${userId}`, {
			windowMs: 60_000,
			max: 30,
		})
	) {
		return Response.json({ message: "Too many requests" }, { status: 429 });
	}

	const { appName } = await params;
	const application = await findApplicationByAppNameForUser(appName, userId);
	if (!application) {
		return Response.json({ message: `Application not found: ${appName}` }, { status: 404 });
	}

	const organizationId = application.environment.project.organizationId;
	// A key bound to one organization must not reach an app in another, even
	// when its owner is a member of both.
	const boundOrganizationId = ctx.apiKey.organizationId;
	if (boundOrganizationId && boundOrganizationId !== organizationId) {
		return Response.json({ message: `Application not found: ${appName}` }, { status: 404 });
	}

	// Org-level 2FA enforcement applies to key callers too.
	if (await isTwoFactorGateBlocked(userId, organizationId)) {
		return Response.json({ message: TWO_FACTOR_REQUIRED_MESSAGE }, { status: 403 });
	}

	// Honours the key's scope: this route is not a tRPC procedure, so it enters
	// the ceiling itself (protectedProcedure does it for REST/MCP callers).
	const canDeploy = ctx.capabilityScope
		? await runWithCapabilityScope(ctx.capabilityScope, () =>
				hasCapability(userId, organizationId, "service.deploy"),
			)
		: await hasCapability(userId, organizationId, "service.deploy");
	if (!canDeploy) {
		// Same 404 as cross-tenant misses — do not reveal the app exists.
		return Response.json({ message: `Application not found: ${appName}` }, { status: 404 });
	}

	// An API-key caller, not a provider push: recorded as `api` by the key owner.
	const deploymentId = await queueWebhookDeployment(
		application.applicationId,
		"Webhook: manual deploy trigger",
		{ trigger: "api", triggeredBy: userId },
	);
	return Response.json({
		applicationId: application.applicationId,
		deploymentId,
	});
}
