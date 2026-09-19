import { classifyLogLine, type LogLineLevel } from "../observability/log-levels";

/** One stored line. `container` is the compose/stack service name when the stack has several. */
export interface RuntimeLogLine {
	/** Epoch milliseconds (from Docker's own timestamp, not the harvest time). */
	t: number;
	level: LogLineLevel;
	message: string;
	container?: string | null;
}

/** Compact on-disk shape (one JSON object per line). */
interface StoredLine {
	t: number;
	l: LogLineLevel;
	m: string;
	c?: string;
}

export const encodeLogLine = (line: RuntimeLogLine): string => {
	const stored: StoredLine = { t: line.t, l: line.level, m: line.message };
	if (line.container) stored.c = line.container;
	return JSON.stringify(stored);
};

/** Parse a JSONL body; a torn last line (a crash mid-append) is skipped, not fatal. */
export function parseLogLines(text: string): RuntimeLogLine[] {
	const lines: RuntimeLogLine[] = [];
	for (const raw of text.split("\n")) {
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw) as Partial<StoredLine>;
			if (typeof parsed.t !== "number" || typeof parsed.m !== "string") continue;
			lines.push({
				t: parsed.t,
				level: parsed.l ?? "default",
				message: parsed.m,
				container: parsed.c ?? null,
			});
		} catch {
			// torn line
		}
	}
	return lines;
}

/**
 * A container started without a TTY multiplexes stdout/stderr into 8-byte
 * framed chunks (`[type, 0, 0, 0, size:uint32be]`); a TTY container streams
 * raw bytes. With `--timestamps` every raw line starts with a digit, so a
 * leading byte of 0/1/2 followed by three zero bytes can only be a frame.
 */
export function demuxDockerLogs(buffer: Buffer): string {
	if (buffer.length < 8) return buffer.toString("utf8");
	const type = buffer[0] ?? 0;
	if (type > 2 || buffer[1] !== 0 || buffer[2] !== 0 || buffer[3] !== 0) {
		return buffer.toString("utf8");
	}
	const parts: string[] = [];
	let offset = 0;
	while (offset + 8 <= buffer.length) {
		const size = buffer.readUInt32BE(offset + 4);
		const start = offset + 8;
		const end = Math.min(start + size, buffer.length);
		parts.push(buffer.subarray(start, end).toString("utf8"));
		offset = end;
		if (size === 0) break;
	}
	return parts.join("");
}

/** Docker's `--timestamps` prefix: RFC 3339 with nanoseconds, always UTC. */
const DOCKER_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)\s?/;

export interface DockerLogLine {
	/** The prefix verbatim — the cursor for the next `--since`. */
	ts: string;
	/** Epoch milliseconds (nanoseconds truncated). */
	t: number;
	message: string;
}

/**
 * Split `docker logs --timestamps` output into lines. A line without a
 * timestamp (a stack trace continuation, a torn frame) is appended to the
 * previous line so multi-line output stays one entry; leading ones are
 * dropped.
 */
export function splitDockerLogLines(text: string): DockerLogLine[] {
	const out: DockerLogLine[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (!line) continue;
		const match = DOCKER_TS_RE.exec(line);
		if (!match) {
			const previous = out[out.length - 1];
			if (previous) previous.message += `\n${line}`;
			continue;
		}
		const ts = match[1] ?? "";
		const t = Date.parse(ts);
		if (!Number.isFinite(t)) continue;
		out.push({ ts, t, message: line.slice(match[0].length) });
	}
	return out;
}

/**
 * Docker timestamps are fixed-width RFC 3339 nanosecond strings, so a plain
 * string comparison orders them; anything else falls back to a Date parse.
 */
export function compareDockerTs(a: string, b: string): number {
	if (a.length === b.length) return a < b ? -1 : a > b ? 1 : 0;
	const ta = Date.parse(a);
	const tb = Date.parse(b);
	return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/**
 * The Engine API's `since` is `<seconds>.<nanoseconds>`; the CLI accepts the
 * RFC 3339 form. Both are inclusive, so the caller dedupes with
 * {@link compareDockerTs} against the cursor.
 */
export function dockerSinceParam(ts: string): string {
	const ms = Date.parse(ts);
	if (!Number.isFinite(ms)) return "0";
	const seconds = Math.floor(ms / 1000);
	const fraction = /\.(\d{1,9})Z$/.exec(ts)?.[1] ?? "";
	const nanos = fraction.padEnd(9, "0");
	return `${seconds}.${nanos}`;
}

/** Turn harvested Docker lines into stored lines (level classified once, here). */
export function toRuntimeLogLines(
	lines: readonly DockerLogLine[],
	container: string | null,
): RuntimeLogLine[] {
	return lines.map((line) => {
		const { level, text } = classifyLogLine(line.message);
		return { t: line.t, level, message: text, container };
	});
}
