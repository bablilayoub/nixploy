import { AGENTS_MD } from "@/lib/docs/agents-md";

export const dynamic = "force-static";

export function GET(): Response {
	return new Response(AGENTS_MD, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}
