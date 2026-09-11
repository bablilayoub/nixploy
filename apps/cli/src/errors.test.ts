import { describe, expect, it } from "vitest";
import { ApiError, parseRetryAfter } from "./client.js";
import {
	CliError,
	EXIT_DENIED,
	EXIT_ERROR,
	EXIT_OK,
	EXIT_USAGE,
	exitCodeForStatus,
	notFoundError,
	rateLimitMessage,
	usageError,
} from "./errors.js";

describe("exit-code contract", () => {
	it("keeps the documented numbers stable", () => {
		// Scripts branch on these; changing one is a breaking CLI change.
		expect([EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_DENIED]).toEqual([0, 1, 2, 3]);
	});

	it("maps auth, permission and missing-resource statuses to 3", () => {
		expect(exitCodeForStatus(401)).toBe(EXIT_DENIED);
		expect(exitCodeForStatus(403)).toBe(EXIT_DENIED);
		expect(exitCodeForStatus(404)).toBe(EXIT_DENIED);
	});

	it("maps every other failure to 1", () => {
		for (const status of [400, 409, 413, 422, 429, 500, 502]) {
			expect(exitCodeForStatus(status), String(status)).toBe(EXIT_ERROR);
		}
	});

	it("gives ApiError the exit code of its status", () => {
		expect(new ApiError("nope", 403).exitCode).toBe(EXIT_DENIED);
		expect(new ApiError("boom", 500).exitCode).toBe(EXIT_ERROR);
	});

	it("defaults CliError to a runtime error and lets helpers override it", () => {
		expect(new CliError("boom").exitCode).toBe(EXIT_ERROR);
		expect(usageError("missing --project-id").exitCode).toBe(EXIT_USAGE);
		expect(notFoundError("no such app").exitCode).toBe(EXIT_DENIED);
	});

	it("keeps the message intact for stderr rendering", () => {
		const error = usageError("Provide exactly one of --application-id, --compose-id");
		expect(error.message).toContain("--application-id");
		expect(error.name).toBe("CliError");
	});
});

describe("rate-limit reporting", () => {
	it("turns a Retry-After into an instruction instead of an auth error", () => {
		expect(rateLimitMessage(13)).toBe("Rate limited — retry in 13s");
		expect(rateLimitMessage(1)).toBe("Rate limited — retry in 1s");
	});

	it("falls back to the panel's own wording, then to a generic hint", () => {
		expect(rateLimitMessage(null, "Too many requests from this address")).toBe(
			"Rate limited — Too many requests from this address",
		);
		expect(rateLimitMessage(0)).toBe("Rate limited — retry in a minute");
		expect(rateLimitMessage(undefined)).toBe("Rate limited — retry in a minute");
	});

	it("carries Retry-After on the ApiError", () => {
		expect(new ApiError("throttled", 429, 30).retryAfterSeconds).toBe(30);
		expect(new ApiError("boom", 500).retryAfterSeconds).toBeNull();
	});
});

describe("parseRetryAfter", () => {
	it("reads delta-seconds", () => {
		expect(parseRetryAfter("42")).toBe(42);
		expect(parseRetryAfter("  7 ")).toBe(7);
	});

	it("reads an HTTP-date relative to now", () => {
		const now = Date.parse("2026-09-11T12:00:00Z");
		expect(parseRetryAfter("Fri, 11 Sep 2026 12:00:30 GMT", now)).toBe(30);
	});

	it("ignores absent, zero and unparsable values", () => {
		expect(parseRetryAfter(null)).toBeNull();
		expect(parseRetryAfter("")).toBeNull();
		expect(parseRetryAfter("0")).toBeNull();
		expect(parseRetryAfter("soon")).toBeNull();
		// A date already in the past is not a countdown.
		expect(
			parseRetryAfter("Fri, 11 Sep 2026 11:59:00 GMT", Date.parse("2026-09-11T12:00:00Z")),
		).toBeNull();
	});
});
