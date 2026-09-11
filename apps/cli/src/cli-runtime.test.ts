import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import { applyExitOverride, resolveExitCode } from "./cli-runtime.js";
import { ApiError } from "./client.js";
import { CliError, EXIT_DENIED, EXIT_ERROR, EXIT_OK, EXIT_USAGE, usageError } from "./errors.js";

describe("applyExitOverride", () => {
	/** A group attached with addCommand, like the registry builds. */
	function buildProgram(): Command {
		const program = new Command().name("nixploy").exitOverride();
		const group = new Command("project").description("Manage projects");
		group
			.command("list")
			.description("List projects")
			.option("--json", "JSON")
			.action(() => {});
		program.addCommand(group);
		return program;
	}

	it("reaches sub-commands attached with addCommand", () => {
		const program = buildProgram();
		applyExitOverride(program);
		// Without the recursive pass this would call process.exit(1) instead.
		expect(() => program.parse(["node", "nixploy", "project", "list", "--nope"])).toThrow(
			CommanderError,
		);
	});

	it("leaves a valid invocation alone", () => {
		const program = buildProgram();
		applyExitOverride(program);
		expect(() => program.parse(["node", "nixploy", "project", "list"])).not.toThrow();
	});

	it("routes commander's own error output to stderr", () => {
		const program = buildProgram();
		applyExitOverride(program);
		const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			expect(() => program.parse(["node", "nixploy", "project", "list", "--nope"])).toThrow();
			expect(spy).toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});

describe("resolveExitCode", () => {
	it("treats printed help and version as success with no extra output", () => {
		for (const code of ["commander.helpDisplayed", "commander.help", "commander.version"]) {
			expect(resolveExitCode(new CommanderError(1, code, ""))).toEqual({
				code: EXIT_OK,
				message: null,
			});
		}
	});

	it("treats every other commander error as a usage error", () => {
		expect(
			resolveExitCode(new CommanderError(1, "commander.unknownOption", "unknown option")),
		).toEqual({ code: EXIT_USAGE, message: null });
		expect(
			resolveExitCode(new CommanderError(1, "commander.missingArgument", "missing argument")),
		).toEqual({ code: EXIT_USAGE, message: null });
	});

	it("carries a CliError's own exit code", () => {
		expect(resolveExitCode(usageError("missing --project-id"))).toEqual({
			code: EXIT_USAGE,
			message: "Error: missing --project-id",
		});
		expect(resolveExitCode(new CliError("boom"))).toEqual({
			code: EXIT_ERROR,
			message: "Error: boom",
		});
	});

	it("labels API failures with their HTTP status", () => {
		expect(resolveExitCode(new ApiError("forbidden", 403))).toEqual({
			code: EXIT_DENIED,
			message: "Error (HTTP 403): forbidden",
		});
		expect(resolveExitCode(new ApiError("kaput", 500))).toEqual({
			code: EXIT_ERROR,
			message: "Error (HTTP 500): kaput",
		});
	});

	it("reports a throttled request as a rate limit, not as an auth failure", () => {
		expect(resolveExitCode(new ApiError("API key rate limit exceeded", 429, 13))).toEqual({
			code: EXIT_ERROR,
			message: "Error (HTTP 429): Rate limited — retry in 13s",
		});
		// No Retry-After header: keep the panel's own wording.
		expect(resolveExitCode(new ApiError("Too many requests from this address", 429))).toEqual({
			code: EXIT_ERROR,
			message: "Error (HTTP 429): Rate limited — Too many requests from this address",
		});
	});

	it("falls back to a plain runtime error for anything else", () => {
		expect(resolveExitCode(new Error("socket hang up"))).toEqual({
			code: EXIT_ERROR,
			message: "Error: socket hang up",
		});
		expect(resolveExitCode("weird")).toEqual({ code: EXIT_ERROR, message: "Error: weird" });
	});
});
