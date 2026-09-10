import { appRouter } from "@nixploy/server/trpc";
import { createTRPCContext } from "@nixploy/server/trpc/init";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Largest request body the tRPC endpoint accepts. The biggest legitimate
 * payloads are 1 MiB compose files / env blobs (zod caps in the routers);
 * everything above that is a memory-DoS attempt against the single panel
 * process, which the fetch adapter would otherwise buffer whole. Mirrors the
 * REST adapter's check (`api/[...rest]/route.ts`).
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const payloadTooLarge = () =>
	Response.json(
		{
			error: {
				message: "Payload too large",
				code: -32013,
				data: { code: "PAYLOAD_TOO_LARGE", httpStatus: 413 },
			},
		},
		{ status: 413 },
	);

/**
 * Read the body up to `limit` bytes. Rejects as soon as the cap is crossed so
 * a chunked upload without `content-length` cannot grow the buffer either.
 */
async function readBodyCapped(
	body: ReadableStream<Uint8Array>,
	limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				throw new RangeError("body too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const merged = new Uint8Array(new ArrayBuffer(total));
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

async function boundedRequest(req: Request): Promise<Request | null> {
	if (req.method !== "POST" || !req.body) return req;
	const contentLength = Number(req.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return null;
	let body: Uint8Array<ArrayBuffer>;
	try {
		body = await readBodyCapped(req.body, MAX_BODY_BYTES);
	} catch (error) {
		if (error instanceof RangeError) return null;
		throw error;
	}
	return new Request(req.url, { method: req.method, headers: req.headers, body });
}

const handler = async (incoming: Request) => {
	const req = await boundedRequest(incoming);
	if (!req) return payloadTooLarge();
	return fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createTRPCContext({ headers: req.headers }),
	});
};

export { handler as GET, handler as POST };
