export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness: the process is up and serving HTTP. Unauthenticated, no
 * dependencies — `/api/ready` is the one that checks Postgres, Docker,
 * migrations and the proxy.
 */
export function GET() {
	return Response.json(
		{ ok: true, uptimeSeconds: Math.round(process.uptime()) },
		{ headers: { "cache-control": "no-store" } },
	);
}
