import { findApplicationByAppNameForUser } from "@nixploy/server/modules/application/org";
import { queueWebhookDeployment } from "@nixploy/server/modules/git/webhook-handler";
import { authenticateApiKey } from "../../verify-api-key";

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
 * owner is a member of.
 */
export async function POST(req: Request, { params }: RouteParams) {
	const authenticated = await authenticateApiKey(req);
	if (authenticated instanceof Response) return authenticated;

	const { appName } = await params;
	const application = await findApplicationByAppNameForUser(appName, authenticated.userId);
	if (!application) {
		return Response.json({ message: `Application not found: ${appName}` }, { status: 404 });
	}

	const deploymentId = await queueWebhookDeployment(
		application.applicationId,
		"Webhook: manual deploy trigger",
	);
	return Response.json({
		applicationId: application.applicationId,
		deploymentId,
	});
}
