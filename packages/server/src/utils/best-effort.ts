import { createLogger, type Logger } from "../lib/logger";

const log = createLogger("best-effort");

type BestEffortLevel = keyof Logger;

/**
 * Run a side effect whose failure must not fail the caller — teardown sweeps,
 * temp-file cleanup, cache writes, status patches after a failure. Replaces
 * bare `.catch(() => {})`: the failure is logged with `label` (debug by
 * default, `level: "error"` for teardown that leaves orphans behind) so a
 * stale Traefik file or certificate is greppable instead of silent.
 *
 * Genuinely silent cases (removing a file that may not exist) can keep their
 * own catch — this helper is for failures someone would want to see.
 */
export async function bestEffort<T>(
	label: string,
	task: () => Promise<T>,
	level: BestEffortLevel = "debug",
): Promise<T | undefined> {
	try {
		return await task();
	} catch (error) {
		log[level](`${label} failed`, {
			error: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}
