import { appRouter } from "@nixploy/server/trpc";
import { createTRPCContext } from "@nixploy/server/trpc/init";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createTRPCContext({ headers: req.headers }),
	});

export { handler as GET, handler as POST };
