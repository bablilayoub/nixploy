/**
 * One JSON request against a git provider's REST API with that provider's
 * token scheme. Its own module on purpose: the PR comment and the commit
 * status both use it, and the status module sits on the worker's boot path
 * where the Octokit import the comment module carries must not follow.
 */
export async function providerJsonFetch(
	url: string,
	init: RequestInit & {
		token: string;
		tokenScheme?: "Bearer" | "token" | "PRIVATE-TOKEN" | "Basic";
	},
): Promise<unknown> {
	const { token, tokenScheme = "Bearer", headers, ...rest } = init;
	const authHeaders: Record<string, string> =
		tokenScheme === "PRIVATE-TOKEN"
			? { "PRIVATE-TOKEN": token }
			: { Authorization: `${tokenScheme} ${token}` };
	const response = await fetch(url, {
		...rest,
		redirect: rest.redirect ?? "error",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			...authHeaders,
			...(headers as Record<string, string> | undefined),
		},
	});
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	if (response.status === 204) return null;
	return await response.json().catch(() => null);
}
