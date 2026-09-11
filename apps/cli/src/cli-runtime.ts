import { type Command, CommanderError } from "commander";
import { ApiError } from "./client.js";
import { CliError, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "./errors.js";

/**
 * Commander exits the process itself on `--help`, an unknown option or a
 * missing argument. Taking that over is what lets usage problems map to exit
 * code 2 while a successful `--help` stays 0.
 *
 * `exitOverride` is per-command and is NOT inherited by sub-commands attached
 * with `addCommand`, so it has to be applied to the whole tree — otherwise
 * `nixploy project list --nope` exits 1 instead of 2.
 */
export function applyExitOverride(command: Command): void {
	command.exitOverride();
	command.configureOutput({ writeErr: (text) => process.stderr.write(text) });
	for (const child of command.commands) {
		applyExitOverride(child);
	}
}

/** Codes commander uses for output it has already printed successfully. */
const COMMANDER_SUCCESS_CODES = new Set([
	"commander.helpDisplayed",
	"commander.help",
	"commander.version",
]);

/**
 * Map a thrown value onto the documented exit-code contract
 * (0 ok · 1 error · 2 usage · 3 not found/forbidden) and produce the stderr
 * line that goes with it.
 */
export function resolveExitCode(error: unknown): { code: number; message: string | null } {
	if (error instanceof CommanderError) {
		// Help and version were requested and are already on stdout.
		return COMMANDER_SUCCESS_CODES.has(error.code)
			? { code: EXIT_OK, message: null }
			: { code: EXIT_USAGE, message: null };
	}
	if (error instanceof CliError) {
		return { code: error.exitCode, message: `Error: ${error.message}` };
	}
	if (error instanceof ApiError) {
		return { code: error.exitCode, message: `Error (HTTP ${error.status}): ${error.message}` };
	}
	if (error instanceof Error) {
		return { code: EXIT_ERROR, message: `Error: ${error.message}` };
	}
	return { code: EXIT_ERROR, message: `Error: ${String(error)}` };
}
