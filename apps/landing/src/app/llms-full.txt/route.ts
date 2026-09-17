import { renderLlmsFullTxt } from "@/lib/docs/markdown";

export const dynamic = "force-static";

export function GET(): Response {
	return new Response(renderLlmsFullTxt(), {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
