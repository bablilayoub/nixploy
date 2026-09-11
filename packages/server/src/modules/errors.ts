/**
 * Domain errors — the one error type modules throw for mistakes a caller can
 * act on (bad input, missing rows, conflicts, unmet preconditions).
 *
 * `code` mirrors tRPC's `TRPC_ERROR_CODE_KEY` without importing `@trpc/server`
 * here (modules stay transport-agnostic; `trpc/init.ts` checks the two unions
 * agree at compile time). The error boundary in `trpc/init.ts` maps a
 * `DomainError` to a `TRPCError` with the same code and message, so the REST
 * adapter (HTTP status), MCP (`CODE: message`) and the panel toast all inherit
 * it. Anything else thrown from a module is treated as a bug: it becomes
 * INTERNAL_SERVER_ERROR with a generic message in production.
 *
 * Messages are shown to users verbatim — keep stderr, paths and secrets off
 * them (put those in `cause` or a dedicated field instead).
 */
export type DomainErrorCode =
	| "PARSE_ERROR"
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "METHOD_NOT_SUPPORTED"
	| "TIMEOUT"
	| "CONFLICT"
	| "PRECONDITION_FAILED"
	| "PAYLOAD_TOO_LARGE"
	| "UNPROCESSABLE_CONTENT"
	| "TOO_MANY_REQUESTS"
	| "INTERNAL_SERVER_ERROR"
	| "NOT_IMPLEMENTED";

export interface DomainErrorOptions {
	cause?: unknown;
}

export class DomainError extends Error {
	readonly code: DomainErrorCode;
	/**
	 * Brand for `isDomainError`: `instanceof` fails when two copies of this
	 * module are loaded (tsx + Next each bundle `packages/server` once, see the
	 * `apps/web/server.ts` note in CLAUDE.md), the brand survives that.
	 */
	readonly domainError = true as const;

	constructor(code: DomainErrorCode, message: string, options: DomainErrorOptions = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "DomainError";
		this.code = code;
	}
}

export function isDomainError(error: unknown): error is DomainError {
	if (error instanceof DomainError) return true;
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { domainError?: unknown }).domainError === true &&
		typeof (error as { code?: unknown }).code === "string" &&
		typeof (error as { message?: unknown }).message === "string"
	);
}

/** Invalid input the caller can correct (HTTP 400). */
export const badRequest = (message: string, cause?: unknown): DomainError =>
	new DomainError("BAD_REQUEST", message, { cause });

/** Missing session / bad credentials (HTTP 401). */
export const unauthorized = (message: string, cause?: unknown): DomainError =>
	new DomainError("UNAUTHORIZED", message, { cause });

/** Authenticated but not allowed (HTTP 403). */
export const forbidden = (message: string, cause?: unknown): DomainError =>
	new DomainError("FORBIDDEN", message, { cause });

/** The row does not exist or belongs to another tenant (HTTP 404). */
export const notFound = (message: string, cause?: unknown): DomainError =>
	new DomainError("NOT_FOUND", message, { cause });

/** Already exists / clashes with another resource (HTTP 409). */
export const conflict = (message: string, cause?: unknown): DomainError =>
	new DomainError("CONFLICT", message, { cause });

/** Valid request but the resource is not in the right state for it (HTTP 412). */
export const preconditionFailed = (message: string, cause?: unknown): DomainError =>
	new DomainError("PRECONDITION_FAILED", message, { cause });

/** A remote step did not finish in time (HTTP 408). */
export const timeout = (message: string, cause?: unknown): DomainError =>
	new DomainError("TIMEOUT", message, { cause });

/** Too much data for the panel to accept (HTTP 413). */
export const payloadTooLarge = (message: string, cause?: unknown): DomainError =>
	new DomainError("PAYLOAD_TOO_LARGE", message, { cause });

/**
 * Postgres unique-violation (`23505`) detection. drizzle wraps the driver
 * error, so the SQLSTATE lives on `error.cause.code`; a bare
 * `error.code === "23505"` never matches and the raw `Failed query: …` SQL
 * (with bound parameters) used to leak to the client.
 */
export function isUniqueViolation(error: unknown): boolean {
	const codeOf = (value: unknown): string | undefined =>
		typeof value === "object" && value !== null && "code" in value
			? String((value as { code?: unknown }).code)
			: undefined;
	return (
		codeOf(error) === "23505" || codeOf((error as { cause?: unknown } | null)?.cause) === "23505"
	);
}
