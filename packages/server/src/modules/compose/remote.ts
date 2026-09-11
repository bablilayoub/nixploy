import { assertSafeOutboundUrl, pinnedFetch } from "../../utils/public-url";
import { badRequest } from "../errors";

/**
 * "Deploy from compose URL" (product audit, Platform row). The URL goes
 * through the egress guard — cloud metadata, link-local, reserved and overlay
 * literals are always refused, and a LAN target only resolves when the
 * instance admin turned private egress on — and the fetch dials only the
 * vetted addresses (`pinnedFetch`, no redirects followed).
 *
 * The body is NOT validated here: the caller runs it through
 * `saveComposeFile`, which is the single place compose safety is enforced.
 */

/** Hard cap on a fetched compose file — the same order as `textBlobSchema`. */
export const MAX_REMOTE_COMPOSE_BYTES = 256 * 1024;

const REQUEST_TIMEOUT_MS = 15_000;

/** HTML is the usual mistake: a repo page URL instead of the raw file. */
function looksLikeHtml(body: string, contentType: string | null): boolean {
	if (contentType?.toLowerCase().includes("text/html")) return true;
	return /^\s*<(?:!doctype|html)\b/i.test(body);
}

/**
 * Fetch a compose file over http(s). Returns the body; throws a DomainError
 * with a message safe to show the operator.
 */
export async function fetchComposeFromUrl(url: string): Promise<string> {
	const target = await assertSafeOutboundUrl(url, { allowPrivate: true });
	let response: Awaited<ReturnType<typeof pinnedFetch>>;
	try {
		response = await pinnedFetch(target, {
			timeoutMs: REQUEST_TIMEOUT_MS,
			maxBytes: MAX_REMOTE_COMPOSE_BYTES,
			headers: { accept: "text/yaml, application/yaml, text/plain, */*" },
		});
	} catch (error) {
		throw badRequest(
			`Could not fetch the compose file: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!response.ok) {
		// A 3xx lands here too: `pinnedFetch` never follows redirects, so a
		// shortener or a repo "blob" URL has to be given as its raw target.
		throw badRequest(
			`Could not fetch the compose file (HTTP ${response.status}${
				response.status >= 300 && response.status < 400 ? " — redirects are not followed" : ""
			})`,
		);
	}
	const body = response.body;
	if (!body.trim()) {
		throw badRequest("The URL returned an empty compose file");
	}
	if (looksLikeHtml(body, response.headers.get("content-type"))) {
		throw badRequest("The URL returned an HTML page, not a compose file — use the raw file URL");
	}
	return body;
}
