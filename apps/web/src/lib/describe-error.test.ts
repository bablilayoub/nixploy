import { afterEach, describe, expect, it, vi } from "vitest";

import { describeError } from "@/lib/describe-error";

const GENERIC_SERVER_ERROR = "Something went wrong on the server — check the panel logs.";
const NETWORK_ERROR = "Cannot reach the panel — check your connection and try again.";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("describeError", () => {
	it("passes strings through and falls back on unusable input", () => {
		expect(describeError("  Disk is full  ")).toBe("Disk is full");
		expect(describeError("   ", "Fallback.")).toBe("Fallback.");
		expect(describeError(null, "Fallback.")).toBe("Fallback.");
		expect(describeError(42, "Fallback.")).toBe("Fallback.");
		expect(describeError({})).toBe("Something went wrong.");
	});

	it("detects transport failures", () => {
		expect(describeError(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR);
		expect(describeError({ message: "Load failed" })).toBe(NETWORK_ERROR);
		expect(describeError({ message: "boom", cause: new TypeError("fetch failed") })).toBe(
			NETWORK_ERROR,
		);
		// A tRPC error is never a network error, whatever its message says.
		expect(describeError({ message: "failed to fetch the row", data: { code: "NOT_FOUND" } })).toBe(
			"failed to fetch the row",
		);
	});

	it("maps tRPC codes to actionable sentences", () => {
		expect(describeError({ message: "needs project.write", data: { code: "FORBIDDEN" } })).toBe(
			"You don't have permission to do that. (needs project.write)",
		);
		// A bare code as the message adds nothing — drop it.
		expect(describeError({ message: "FORBIDDEN", data: { code: "FORBIDDEN" } })).toBe(
			"You don't have permission to do that.",
		);
		expect(describeError({ message: "x", data: { code: "UNAUTHORIZED" } })).toBe(
			"Your session expired — sign in again.",
		);
		expect(describeError({ message: "NOT_FOUND", data: { code: "NOT_FOUND" } })).toBe("Not found.");
		expect(describeError({ message: "No such app", data: { code: "NOT_FOUND" } })).toBe(
			"No such app",
		);
		expect(describeError({ message: "x", data: { code: "PAYLOAD_TOO_LARGE" } })).toBe(
			"That request is too large for the panel to accept.",
		);
		expect(describeError({ message: "x", data: { code: "TOO_MANY_REQUESTS" } })).toBe(
			"Too many requests — wait a moment and try again.",
		);
		// BAD_REQUEST and friends: the server message is the reason.
		expect(describeError({ message: "Image name invalid", data: { code: "BAD_REQUEST" } })).toBe(
			"Image name invalid",
		);
	});

	it("hides server-error detail in production only", () => {
		const error = { message: "column does not exist", data: { code: "INTERNAL_SERVER_ERROR" } };
		expect(describeError(error)).toBe(`${GENERIC_SERVER_ERROR} (column does not exist)`);
		vi.stubEnv("NODE_ENV", "production");
		expect(describeError(error)).toBe(GENERIC_SERVER_ERROR);
	});

	it("flattens a raw zod issue array", () => {
		const message = JSON.stringify([
			{ path: ["name"], message: "Required" },
			{ path: [], message: "Invalid input" },
		]);
		expect(describeError({ message, data: { code: "BAD_REQUEST", zodIssues: [1] } })).toBe(
			"name: Required; Invalid input",
		);
	});

	it("falls back to the HTTP status for non-tRPC failures", () => {
		expect(
			describeError({ message: "Payload too large", meta: { response: { status: 413 } } }),
		).toBe("That request is too large for the panel to accept.");
		expect(describeError({ message: "Bad gateway", meta: { response: { status: 502 } } })).toBe(
			`${GENERIC_SERVER_ERROR} (Bad gateway)`,
		);
		// better-auth style: a plain object with a message and no tRPC data.
		expect(describeError({ message: "Invalid password", status: 401 })).toBe("Invalid password");
	});
});
