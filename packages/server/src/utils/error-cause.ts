/**
 * Error messages that keep the reason.
 *
 * Drizzle wraps a driver failure in a `DrizzleQueryError` whose `message` is
 * the SQL and the parameter list — `Failed query: select … params: true` —
 * and puts the reason on `cause`: `terminating connection due to
 * administrator command`, `column … does not exist`, `permission denied`.
 * A handler that logs only `error.message` therefore reports the symptom and
 * throws away the diagnosis.
 *
 * That is not hypothetical. The hourly maintenance pass failed on every
 * install for weeks saying nothing but `Failed query: …` (2026-09-14), and on
 * 2026-09-20 the production metrics pass logged the same shape 17 seconds
 * before Postgres shut down for an update — a completely benign restart that
 * read as a schema bug, because the one word that would have settled it
 * (`terminating connection due to administrator command`) was dropped.
 *
 * Anything that catches an error from a code path that can reach the database
 * and then logs it should use this instead of `error.message`.
 */

/** How deep to follow `cause`; a chain longer than this is noise in a log line. */
const MAX_DEPTH = 3;

/**
 * `error.message`, followed by each distinct `cause` message.
 *
 * Non-errors are stringified. A cause that repeats the message it hangs off
 * is skipped, so a wrapper that copied its child's text does not double it.
 */
export function describeErrorWithCause(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const parts: string[] = [error.message];
	let current: unknown = (error as { cause?: unknown }).cause;
	for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current !== null; depth += 1) {
		const message =
			current instanceof Error ? current.message : typeof current === "string" ? current : null;
		if (!message) break;
		// A cause that says what the wrapper already said adds nothing.
		if (!parts.some((part) => part.includes(message) || message.includes(part))) {
			parts.push(message);
		}
		current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
	}
	return parts.join(" — cause: ");
}
