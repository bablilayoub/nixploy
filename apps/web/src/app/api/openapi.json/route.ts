import { generateOpenApiDocument } from "@nixploy/server/trpc/openapi";

import { getSession } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the OpenAPI document generated from the tRPC appRouter. */
export async function GET() {
	// The schema enumerates every procedure — keep it behind the session.
	const session = await getSession();
	if (!session) {
		return Response.json({ message: "Unauthorized" }, { status: 401 });
	}
	return Response.json(generateOpenApiDocument());
}
