import { buildApiKeyContext } from "@nixploy/server/lib/api-key-context";
import {
	isTwoFactorGateBlocked,
	TWO_FACTOR_REQUIRED_MESSAGE,
} from "@nixploy/server/modules/auth/two-factor-gate";
import {
	collectPrometheusSnapshot,
	PROMETHEUS_CONTENT_TYPE,
	renderPrometheus,
} from "@nixploy/server/modules/monitoring/prometheus";
import { resolveCallerOrganizationId } from "@nixploy/server/modules/projects/index";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/metrics` — Prometheus / OpenMetrics text exposition of the
 * calling API key's organization (product audit, Observability row 3).
 *
 * Auth is the same as the REST adapter and the MCP endpoint:
 * `buildApiKeyContext` with `x-api-key` **or** `Authorization: Bearer`, which
 * brings the per-IP and per-key rate limits, key scopes and the key's
 * organization binding with it — there is no second auth path to keep in
 * sync. A scrape is a read, so no capability beyond org membership is
 * required (the same bar as `monitoring.fleetOverview`); the org-level 2FA
 * gate still applies, because it applies to every key caller.
 *
 * Scoping: one organization per key. A Prometheus that watches several orgs
 * configures one job per key — the alternative (an instance-wide dump for
 * admins) would leak service and project names across tenants into a file
 * anyone with the scrape config can read.
 */
export async function GET(req: Request) {
	let ctx: Awaited<ReturnType<typeof buildApiKeyContext>>;
	try {
		ctx = await buildApiKeyContext(req, { bucket: "metrics-api-key", allowBearer: true });
	} catch (error) {
		if (error instanceof TRPCError) {
			return Response.json(
				{ message: error.message },
				{ status: getHTTPStatusCodeFromError(error) },
			);
		}
		throw error;
	}

	const session = ctx.session;
	if (!session) {
		return Response.json({ message: "Invalid or expired API key" }, { status: 401 });
	}

	let organizationId: string;
	try {
		organizationId = await resolveCallerOrganizationId(
			session.user.id,
			session.session.activeOrganizationId,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "No organization for this API key";
		return Response.json({ message }, { status: 403 });
	}

	if (await isTwoFactorGateBlocked(session.user.id, organizationId)) {
		return Response.json({ message: TWO_FACTOR_REQUIRED_MESSAGE }, { status: 403 });
	}

	const snapshot = await collectPrometheusSnapshot(organizationId);
	return new Response(renderPrometheus(snapshot), {
		status: 200,
		headers: {
			"content-type": PROMETHEUS_CONTENT_TYPE,
			// A scrape must never be served from a proxy cache: the numbers are
			// the point.
			"cache-control": "no-store",
		},
	});
}
