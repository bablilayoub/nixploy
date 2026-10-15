import { type PinnedFetchInit, safeFetch } from "../../utils/public-url";

const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;

/**
 * One JSON request against a git provider's REST API with that provider's
 * token scheme. Its own module on purpose: the PR comment and the commit
 * status both use it, and the status module sits on the worker's boot path
 * where the Octokit import the comment module carries must not follow.
 */
export async function providerJsonFetch(
	url: string,
	init: Pick<PinnedFetchInit, "method" | "headers" | "body"> & {
		token: string;
		tokenScheme?: "Bearer" | "token" | "PRIVATE-TOKEN" | "Basic";
	},
): Promise<unknown> {
	const { token, tokenScheme = "Bearer", headers, ...rest } = init;
	const authHeaders: Record<string, string> =
		tokenScheme === "PRIVATE-TOKEN"
			? { "PRIVATE-TOKEN": token }
			: { Authorization: `${tokenScheme} ${token}` };
	// Self-hosted providers follow the same instance-admin private-egress
	// policy as repository lookups. Pin the vetted address for every request;
	// redirects must never carry a provider token to a different destination.
	const response = await safeFetch(
		url,
		{ allowPrivate: true, allowHttp: true },
		{
			...rest,
			timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				...authHeaders,
				...headers,
			},
		},
	);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	if (response.status === 204) return null;
	try {
		return response.json();
	} catch {
		return null;
	}
}
