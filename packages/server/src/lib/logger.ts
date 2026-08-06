type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function configuredLevel(): LogLevel {
	const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
	if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
		return raw;
	}
	return "info";
}

function shouldLog(level: LogLevel): boolean {
	return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel()];
}

function write(
	level: LogLevel,
	subsystem: string,
	message: string,
	meta?: Record<string, unknown>,
): void {
	if (!shouldLog(level)) return;
	const useJson = process.env.LOG_FORMAT === "json";
	if (useJson) {
		const line = JSON.stringify({
			ts: new Date().toISOString(),
			level,
			subsystem,
			message,
			...meta,
		});
		if (level === "error") console.error(line);
		else if (level === "warn") console.warn(line);
		else console.log(line);
		return;
	}
	const prefix = `[${subsystem}]`;
	const detail = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
	const line = `${prefix} ${message}${detail}`;
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}

export type Logger = {
	debug: (message: string, meta?: Record<string, unknown>) => void;
	info: (message: string, meta?: Record<string, unknown>) => void;
	warn: (message: string, meta?: Record<string, unknown>) => void;
	error: (message: string, meta?: Record<string, unknown>) => void;
};

/** Minimal leveled logger. `LOG_LEVEL` (default info), `LOG_FORMAT=json` optional. */
export function createLogger(subsystem: string): Logger {
	return {
		debug: (message, meta) => write("debug", subsystem, message, meta),
		info: (message, meta) => write("info", subsystem, message, meta),
		warn: (message, meta) => write("warn", subsystem, message, meta),
		error: (message, meta) => write("error", subsystem, message, meta),
	};
}
