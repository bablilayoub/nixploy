/**
 * Exit-code contract (documented in docs/cli.md and the README):
 *
 *   0  success
 *   1  runtime error (API rejected the call, network failure, bad input data)
 *   2  usage error (unknown command/flag, missing required option)
 *   3  not found / forbidden (HTTP 401, 403, 404) — a script can branch on it
 */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_DENIED = 3;

/** Error carrying the process exit code the CLI should terminate with. */
export class CliError extends Error {
	constructor(
		message: string,
		public readonly exitCode: number = EXIT_ERROR,
	) {
		super(message);
		this.name = "CliError";
	}
}

/** Bad invocation (missing flag, mutually exclusive flags, unparsable value). */
export const usageError = (message: string): CliError => new CliError(message, EXIT_USAGE);

/** The thing the user asked for does not exist or is not theirs. */
export const notFoundError = (message: string): CliError => new CliError(message, EXIT_DENIED);

/** HTTP status → exit code. Auth/permission/missing all collapse to 3. */
export function exitCodeForStatus(status: number): number {
	if (status === 401 || status === 403 || status === 404) {
		return EXIT_DENIED;
	}
	return EXIT_ERROR;
}
