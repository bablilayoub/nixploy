import { getVersionInfo } from "@nixploy/server/modules/observability/health";
import { version as nextVersion } from "next/package.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build identity for the CLI compatibility check and support requests:
 * `{ version, commit?, node, nextjs }`. Unauthenticated; the same version
 * is shown to every signed-in member in Settings → Updates.
 */
export function GET() {
	return Response.json(
		{ ...getVersionInfo(), nextjs: nextVersion },
		{ headers: { "cache-control": "no-store" } },
	);
}
