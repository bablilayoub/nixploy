import { badRequest } from "../errors";

/** Timestamp plus append position: equal-millisecond lines keep their identity. */
export interface RuntimeLogCursor {
	t: number;
	index: number;
	appName: string;
}

export function encodeRuntimeLogCursor(cursor: RuntimeLogCursor): string {
	return Buffer.from(JSON.stringify([1, cursor.t, cursor.appName, cursor.index])).toString(
		"base64url",
	);
}

export function decodeRuntimeLogCursor(value: string): RuntimeLogCursor {
	try {
		if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value))
			throw new Error("Malformed pagination cursor");
		const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
		if (!Array.isArray(parsed) || parsed.length !== 4)
			throw new Error("Malformed pagination cursor");
		const [version, t, appName, index] = parsed;
		if (
			version !== 1 ||
			typeof t !== "number" ||
			!Number.isSafeInteger(t) ||
			t <= 0 ||
			t > 8_640_000_000_000_000 ||
			typeof appName !== "string" ||
			!/^[a-z0-9][a-z0-9-]{0,63}$/.test(appName) ||
			typeof index !== "number" ||
			!Number.isSafeInteger(index) ||
			index < 0
		)
			throw new Error("Malformed pagination cursor");
		return { t, appName, index };
	} catch {
		throw badRequest("Invalid runtime log cursor. Refresh the history and try again.");
	}
}

/** Newest timestamp, then service name, then newest append position. */
export function compareRuntimeLogCursors(a: RuntimeLogCursor, b: RuntimeLogCursor): number {
	return (
		b.t - a.t || (a.appName < b.appName ? -1 : a.appName > b.appName ? 1 : 0) || b.index - a.index
	);
}
