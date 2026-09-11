import { checkReadiness } from "@nixploy/server/modules/observability/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness: 200 with the per-check report when the panel can serve, 503
 * listing the failing checks otherwise. Unauthenticated (Swarm HEALTHCHECK,
 * install.sh / update.sh probes, `nixploy doctor`); the report carries no
 * configuration, only check names, latencies and error messages. Results are
 * cached for 5 s inside the server package so polling stays cheap.
 */
export async function GET() {
	const report = await checkReadiness();
	return Response.json(report, {
		status: report.ok ? 200 : 503,
		headers: { "cache-control": "no-store" },
	});
}
