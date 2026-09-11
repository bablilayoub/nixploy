import { describe, expect, it } from "vitest";
import { ApiError } from "./client.js";
import {
	CliError,
	EXIT_DENIED,
	EXIT_ERROR,
	EXIT_OK,
	EXIT_USAGE,
	exitCodeForStatus,
	notFoundError,
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
