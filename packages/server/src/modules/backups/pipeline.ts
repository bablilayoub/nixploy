/**
 * Exit-status-safe `producer | gzip | base64` pipelines.
 *
 * A plain shell pipeline reports the LAST command's status, so a failed
 * pg_dump/mysqldump/tar still produces a valid (empty) gzip stream that
 * base64 happily encodes with exit 0. `set -o pipefail` would fix that but is
 * not available in every remote login shell (dash), so the producer's status
 * is captured in a temp file and echoed after the payload as a trailer that
 * {@link decodePipelineOutput} parses. Pure string helpers — unit-tested
 * without Docker.
 */

/** Trailer separating the base64 payload from the producer's exit status. */
export const PIPELINE_EXIT_MARKER = "==NIXPLOY_EXIT==";

/**
 * Wrap `producer` so the command string prints `<encoded payload>` followed by
 * `==NIXPLOY_EXIT==<producer status>`. When the encoder itself fails no
 * trailer is printed, which the decoder treats as a failure too.
 */
export function buildEncodedPipeline(producer: string, encoder = "gzip | base64"): string {
	return (
		`__nx_rc=$(mktemp) && { ${producer}; echo $? >"$__nx_rc"; } | ${encoder} && ` +
		`echo "${PIPELINE_EXIT_MARKER}$(cat "$__nx_rc")"; rm -f "$__nx_rc"`
	);
}

/** Decode the output of {@link buildEncodedPipeline}; throws unless the producer exited 0. */
export function decodePipelineOutput(raw: string, label: string): Buffer {
	const index = raw.lastIndexOf(PIPELINE_EXIT_MARKER);
	if (index === -1) {
		throw new Error(`${label}: the dump pipeline did not report an exit status`);
	}
	const status = raw.slice(index + PIPELINE_EXIT_MARKER.length).trim();
	if (status !== "0") {
		throw new Error(`${label}: the dump command exited with status ${status || "unknown"}`);
	}
	return Buffer.from(raw.slice(0, index).replace(/\s+/g, ""), "base64");
}

/**
 * Reject archives that are not gzip or that gunzip to 0 bytes. The gzip
 * trailer's ISIZE field (last 4 bytes, little-endian) holds the uncompressed
 * size, so the check needs no decompression. Every archive the runner
 * produces is a single-member stream (one gzip invocation).
 */
export function assertNonEmptyGzip(archive: Buffer, label: string): void {
	if (archive.length < 18 || archive[0] !== 0x1f || archive[1] !== 0x8b) {
		throw new Error(`${label} is not a gzip archive`);
	}
	if (archive.readUInt32LE(archive.length - 4) === 0) {
		throw new Error(`${label} is empty (gunzips to 0 bytes)`);
	}
}

// ── streaming variants ──────────────────────────────────────────────────────
//
// The base64 pipeline above buffers the whole archive in a string, which caps
// dumps at ~37 MB (architecture audit #18). The streaming pipeline keeps
// stdout as raw gzip bytes and moves the producer's exit status to STDERR, so
// the trailer check survives without corrupting the archive.

/**
 * Wrap `producer` so stdout is a plain gzip stream and stderr ends with
 * `==NIXPLOY_EXIT==<producer status>`. Parse it with {@link assertStreamExit}.
 */
export function buildStreamPipeline(producer: string, encoder = "gzip"): string {
	return (
		`__nx_rc=$(mktemp) && { ${producer}; echo $? >"$__nx_rc"; } | ${encoder}; ` +
		`__nx_enc=$?; echo "${PIPELINE_EXIT_MARKER}$(cat "$__nx_rc")" >&2; rm -f "$__nx_rc"; ` +
		`exit $__nx_enc`
	);
}

/** Throw unless the producer of a {@link buildStreamPipeline} exited 0. */
export function assertStreamExit(stderr: string, label: string): void {
	const index = stderr.lastIndexOf(PIPELINE_EXIT_MARKER);
	if (index === -1) {
		throw new Error(`${label}: the dump pipeline did not report an exit status`);
	}
	const status = stderr
		.slice(index + PIPELINE_EXIT_MARKER.length)
		.trim()
		.split(/\s/, 1)[0];
	if (status !== "0") {
		// The producer's own stderr (pg_dump: "the database system is starting
		// up", "role … does not exist", …) is the only clue an operator gets.
		const detail = stderr
			.slice(0, index)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(-3)
			.join(" | ")
			.slice(0, 500);
		throw new Error(
			`${label}: the dump command exited with status ${status || "unknown"}${detail ? ` — ${detail}` : ""}`,
		);
	}
}

/**
 * Streaming equivalent of {@link assertNonEmptyGzip}: watches the first two
 * bytes for the gzip magic and keeps a rolling 4-byte tail for the ISIZE
 * field, so an empty or non-gzip archive is caught without buffering it.
 */
export class GzipShapeCheck {
	private head = Buffer.alloc(0);
	private tail = Buffer.alloc(0);
	private bytes = 0;

	update(chunk: Buffer): void {
		this.bytes += chunk.length;
		if (this.head.length < 2) {
			this.head = Buffer.concat([this.head, chunk.subarray(0, 2)]).subarray(0, 2);
		}
		this.tail = Buffer.concat([this.tail, chunk]).subarray(-4);
	}

	/** Throw unless the stream was a non-empty gzip member. */
	assert(label: string): void {
		if (this.bytes < 18 || this.head[0] !== 0x1f || this.head[1] !== 0x8b) {
			throw new Error(`${label} is not a gzip archive`);
		}
		if (this.tail.length === 4 && this.tail.readUInt32LE(0) === 0) {
			throw new Error(`${label} is empty (gunzips to 0 bytes)`);
		}
	}

	get byteLength(): number {
		return this.bytes;
	}
}
