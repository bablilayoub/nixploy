/**
 * Log-line level classification — one implementation for the panel's log
 * viewer, the runtime log harvester (which stores the level with each line)
 * and search (`level:error`). Deliberately import-free: the panel bundles it.
 */

export const LOG_LINE_LEVELS = ["error", "warn", "success", "info", "debug", "default"] as const;

export type LogLineLevel = (typeof LOG_LINE_LEVELS)[number];

/** Explicit `[tag]` prefixes emitted by our own deploy/log pipelines. */
const PREFIX_TAG_REGEX = /^\[(error|warn(?:ing)?|info|debug|success|ok)\]\s*/i;

/**
 * Classify one line. `text` is the line without an explicit `[tag]` prefix
 * (everything else is returned verbatim).
 */
export const classifyLogLine = (line: string): { level: LogLineLevel; text: string } => {
	const prefix = line.match(PREFIX_TAG_REGEX);
	if (prefix) {
		const tag = (prefix[1] ?? "").toLowerCase();
		const level: LogLineLevel =
			tag === "error"
				? "error"
				: tag.startsWith("warn")
					? "warn"
					: tag === "info"
						? "info"
						: tag === "debug"
							? "debug"
							: "success";
		return { level, text: line.slice(prefix[0].length) };
	}
	if (/^--- Deployment finished:/i.test(line)) {
		return /done|success/i.test(line)
			? { level: "success", text: line }
			: { level: "error", text: line };
	}
	// `failed` on its own, not only `failed to`: the line that actually explains
	// a broken deploy is usually "Deployment failed: …" or "Build failed", and
	// the errors-only filter was hiding exactly the line it exists to find.
	if (/\b(ERROR|FATAL|PANIC)\b/.test(line) || /\bfail(ed|ure)\b|\berror:/i.test(line))
		return { level: "error", text: line };
	if (/\b(WARN|WARNING|CANCELED)\b/.test(line)) return { level: "warn", text: line };
	if (/\bDONE\b/.test(line) || /\bSUCCESS(FUL)?\b/.test(line) || /\bsuccessfully\b/i.test(line))
		return { level: "success", text: line };
	if (/\bDEBUG\b/.test(line)) return { level: "debug", text: line };
	if (/\b(INFO|NOTICE)\b/.test(line) || /\bLOG:/.test(line)) return { level: "info", text: line };
	return { level: "default", text: line };
};
