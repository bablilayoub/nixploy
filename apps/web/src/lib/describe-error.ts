import { toast } from "sonner";

/**
 * Turn anything a mutation or query can reject with into one sentence a
 * person can act on. tRPC client errors carry `data.code` (the server's
 * error boundary in packages/server/src/trpc/init.ts already flattened zod
 * issues into `message` and mapped DomainErrors to their code); better-auth
 * client errors are plain `{ message, status }` objects; fetch failures have
 * a TypeError cause and no `data` at all.
 */

const GENERIC_SERVER_ERROR = "Something went wrong on the server — check the panel logs.";
const NETWORK_ERROR = "Cannot reach the panel — check your connection and try again.";
const DEFAULT_FALLBACK = "Something went wrong.";

interface ErrorLike {
	message?: unknown;
	cause?: unknown;
	data?: { code?: unknown; httpStatus?: unknown; zodIssues?: unknown } | null;
	meta?: { response?: { status?: unknown } | null } | null;
}

const NETWORK_MESSAGE =
	/failed to fetch|load failed|networkerror|network request failed|fetch failed/i;
const BARE_CODE = /^[A-Z_]+$/;

function asErrorLike(error: unknown): ErrorLike | null {
	return typeof error === "object" && error !== null ? (error as ErrorLike) : null;
}

function readMessage(error: ErrorLike | null): string {
	return error && typeof error.message === "string" ? error.message.trim() : "";
}

function isNetworkError(error: ErrorLike, message: string): boolean {
	if (error.data) return false;
	if (error.cause instanceof TypeError) return true;
	return NETWORK_MESSAGE.test(message);
}

/** Older servers (or a bypassed formatter) can still send the raw zod issue array. */
function flattenRawZodMessage(message: string): string | null {
	if (!message.startsWith("[")) return null;
	try {
		const issues: unknown = JSON.parse(message);
		if (!Array.isArray(issues) || issues.length === 0) return null;
		const lines = issues.map((issue: { path?: unknown; message?: unknown }) => {
			const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
			const text = typeof issue.message === "string" ? issue.message : "Invalid value";
			return path ? `${path}: ${text}` : text;
		});
		return lines.join("; ");
	} catch {
		return null;
	}
}

function withDetail(base: string, detail: string): string {
	return detail && !BARE_CODE.test(detail) ? `${base} (${detail})` : base;
}

function withDevDetail(base: string, detail: string): string {
	return process.env.NODE_ENV === "production" ? base : withDetail(base, detail);
}

export function describeError(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
	if (typeof error === "string") return error.trim() || fallback;
	const err = asErrorLike(error);
	if (!err) return fallback;
	const message = readMessage(err);
	if (isNetworkError(err, message)) return NETWORK_ERROR;

	const code = typeof err.data?.code === "string" ? err.data.code : undefined;
	const zodIssues = err.data?.zodIssues;
	if (Array.isArray(zodIssues) && zodIssues.length > 0) {
		return flattenRawZodMessage(message) ?? (message || fallback);
	}

	switch (code) {
		case "FORBIDDEN":
			return withDetail("You don't have permission to do that.", message);
		case "UNAUTHORIZED":
			return "Your session expired — sign in again.";
		case "NOT_FOUND":
			return message && !BARE_CODE.test(message) ? message : "Not found.";
		case "PAYLOAD_TOO_LARGE":
			return "That request is too large for the panel to accept.";
		case "TOO_MANY_REQUESTS":
			return "Too many requests — wait a moment and try again.";
		case "TIMEOUT":
		case "INTERNAL_SERVER_ERROR":
			return withDevDetail(GENERIC_SERVER_ERROR, message);
		case undefined:
			break;
		default:
			// BAD_REQUEST, CONFLICT, PRECONDITION_FAILED, …: the server message
			// is the human-readable reason.
			return flattenRawZodMessage(message) ?? (message || fallback);
	}

	// No tRPC code: a transport-level failure (proxy 502/413 with an HTML
	// body) or a non-tRPC error object such as a better-auth response.
	const httpStatus =
		typeof err.data?.httpStatus === "number"
			? err.data.httpStatus
			: typeof err.meta?.response?.status === "number"
				? err.meta.response.status
				: undefined;
	if (httpStatus === 413) return "That request is too large for the panel to accept.";
	if (httpStatus !== undefined && httpStatus >= 500 && !err.data) {
		return withDevDetail(GENERIC_SERVER_ERROR, message);
	}
	return flattenRawZodMessage(message) ?? (message || fallback);
}

/** `toast.error` with a readable message — use instead of `toast.error(error.message)`. */
export function toastError(error: unknown, fallback?: string): void {
	toast.error(describeError(error, fallback));
}
