import { readBrandingAsset } from "@nixploy/server/modules/branding/index";

/**
 * Serve an uploaded branding asset.
 *
 * Public, because the login page and the favicon are fetched before anyone has
 * a session — and because the file is a logo, which is on the page anyway.
 *
 * `X-Content-Type-Options: nosniff` stops a browser second-guessing the type we
 * derived from the file's own magic bytes. The sandbox `Content-Security-Policy`
 * that neutralises an SVG the sanitiser missed is set in `src/proxy.ts`, **not
 * here**: a header set on this Response is replaced by the global one from
 * `next.config.ts`, and a per-path `headers()` entry there never matched this
 * route. Both were tried against the running server before the proxy was.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	context: { params: Promise<{ name: string }> },
): Promise<Response> {
	const { name } = await context.params;
	const asset = await readBrandingAsset(name);
	if (!asset) {
		return new Response("Not found", { status: 404 });
	}
	return new Response(new Uint8Array(asset.bytes), {
		headers: {
			"content-type": asset.contentType,
			// The file name carries a random suffix per upload, so a stored asset
			// never changes under a URL and can be cached hard.
			"cache-control": "public, max-age=31536000, immutable",
			"x-content-type-options": "nosniff",
		},
	});
}
