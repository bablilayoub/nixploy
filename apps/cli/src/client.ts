import { resolveApiKey, resolveApiUrl } from "./config.js";

export class ApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}

interface RequestOptions {
	method?: "GET" | "POST" | "DELETE";
	body?: unknown;
	query?: Record<string, string | undefined>;
	apiUrl?: string;
	apiKey?: string;
}

/**
 * Calls the Nixploy REST API (generated from the tRPC routers by
 * @nixploy/trpc-openapi). Convention: `/api/<router>.<procedure>`,
 * queries via GET + search params, mutations via POST + JSON body.
 */
export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
	const baseUrl = resolveApiUrl(options.apiUrl);
	const apiKey = resolveApiKey(options.apiKey);

	const url = new URL(`${baseUrl}/api/${path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value !== undefined) {
			url.searchParams.set(key, value);
		}
	}

	const response = await fetch(url, {
		method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
		headers: {
			"x-api-key": apiKey,
			...(options.body !== undefined ? { "content-type": "application/json" } : {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});

	const text = await response.text();
	let data: unknown;
	if (text.length > 0) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}

	if (!response.ok) {
		const message =
			typeof data === "object" && data !== null && "message" in data
				? String((data as { message: unknown }).message)
				: `Request failed with status ${response.status}`;
		throw new ApiError(message, response.status);
	}

	// tRPC HTTP responses wrap payloads in { result: { data } }.
	if (
		typeof data === "object" &&
		data !== null &&
		"result" in data &&
		typeof (data as { result: unknown }).result === "object" &&
		(data as { result: { data?: unknown } }).result !== null &&
		"data" in ((data as { result: object }).result as object)
	) {
		return (data as { result: { data: T } }).result.data;
	}

	return data as T;
}

export const apiGet = <T>(
	path: string,
	query?: Record<string, string | undefined>,
	options?: Pick<RequestOptions, "apiUrl" | "apiKey">,
): Promise<T> => api<T>(path, { ...options, method: "GET", query });

export const apiPost = <T>(
	path: string,
	body?: unknown,
	options?: Pick<RequestOptions, "apiUrl" | "apiKey">,
): Promise<T> => api<T>(path, { ...options, method: "POST", body });
