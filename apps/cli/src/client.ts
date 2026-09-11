import { resolveApiKey, resolveApiUrl } from "./config.js";

declare const __CLI_VERSION__: string;

/** CLI version baked in by tsup (`"dev"` when running from source). */
export const CLI_VERSION: string =
	typeof __CLI_VERSION__ === "string" && __CLI_VERSION__ ? __CLI_VERSION__ : "dev";

/** Sent on every request so panel logs can tell CLI versions apart. */
export const USER_AGENT = `nixploy-cli/${CLI_VERSION}`;

/** Hard cap per request; the panel answers in milliseconds, deploys are queued. */
export const REQUEST_TIMEOUT_MS = 30_000;

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
			"user-agent": USER_AGENT,
			...(options.body !== undefined ? { "content-type": "application/json" } : {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

/**
 * GET with query input. Non-string values (booleans, numbers) are sent as a
 * single JSON `input` blob so Zod schemas receive the correct types. Pure
 * string maps stay flattened for simple filters.
 */
export const apiGet = <T>(
	path: string,
	query?: Record<string, string | number | boolean | undefined>,
	options?: Pick<RequestOptions, "apiUrl" | "apiKey">,
): Promise<T> => {
	if (!query || Object.keys(query).length === 0) {
		return api<T>(path, { ...options, method: "GET" });
	}
	const needsJson = Object.values(query).some((v) => v !== undefined && typeof v !== "string");
	if (needsJson) {
		const cleaned: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(query)) {
			if (value !== undefined) cleaned[key] = value;
		}
		return api<T>(path, {
			...options,
			method: "GET",
			query: { input: JSON.stringify(cleaned) },
		});
	}
	const stringQuery: Record<string, string | undefined> = {};
	for (const [key, value] of Object.entries(query)) {
		stringQuery[key] = value === undefined ? undefined : String(value);
	}
	return api<T>(path, { ...options, method: "GET", query: stringQuery });
};

export const apiPost = <T>(
	path: string,
	body?: unknown,
	options?: Pick<RequestOptions, "apiUrl" | "apiKey">,
): Promise<T> => api<T>(path, { ...options, method: "POST", body });

/**
 * Unauthenticated GET against the panel (`/api/version`, `/api/ready`,
 * `/api/health`): needs the base URL only, no API key. Non-2xx responses
 * still resolve — readiness returns 503 with a body worth showing.
 */
export async function apiPublic<T = unknown>(
	path: string,
	options?: Pick<RequestOptions, "apiUrl">,
): Promise<{ status: number; data: T | null }> {
	const baseUrl = resolveApiUrl(options?.apiUrl);
	const response = await fetch(`${baseUrl}/api/${path}`, {
		headers: { "user-agent": USER_AGENT },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const text = await response.text();
	let data: T | null = null;
	if (text.length > 0) {
		try {
			data = JSON.parse(text) as T;
		} catch {
			data = null;
		}
	}
	return { status: response.status, data };
}
