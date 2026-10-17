/** Leave room below the server's 64 KiB inbound WebSocket message limit. */
const MAX_FRAME_BYTES = 50 * 1024;
const FRAME_OVERHEAD = JSON.stringify({ type: "stdin", data: "" }).length;
// A UTF-16 code unit needs at most six JSON bytes (`\u0000` or a lone surrogate).
const MAX_CHUNK_UNITS = Math.floor((MAX_FRAME_BYTES - FRAME_OVERHEAD) / 6);

/** Encode ordered stdin frames without splitting a Unicode surrogate pair. */
export function terminalInputFrames(data: string): string[] {
	const frames: string[] = [];
	for (let start = 0; start < data.length; ) {
		let end = Math.min(start + MAX_CHUNK_UNITS, data.length);
		if (
			end < data.length &&
			data.charCodeAt(end - 1) >= 0xd800 &&
			data.charCodeAt(end - 1) <= 0xdbff &&
			data.charCodeAt(end) >= 0xdc00 &&
			data.charCodeAt(end) <= 0xdfff
		) {
			end -= 1;
		}
		frames.push(JSON.stringify({ type: "stdin", data: data.slice(start, end) }));
		start = end;
	}
	return frames;
}
