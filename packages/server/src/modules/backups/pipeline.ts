import { finished } from "node:stream/promises";
import { createGunzip } from "node:zlib";

/**
 * POSIX-shell pipelines report only their last command's exit status.
 * Carry the producer status on stderr while stdout stays raw gzip bytes.
 */

export const PIPELINE_EXIT_MARKER = "==NIXPLOY_EXIT==";

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

/** Full streaming gzip validation before an object is finalized. */
export class GzipArchiveCheck {
	private readonly decoder = createGunzip();
	private readonly completed: Promise<void>;
	private uncompressedBytes = 0;
	private bytes = 0;
	private failure: Error | undefined;
	private pendingWrite: ((error?: Error | null) => void) | undefined;

	constructor() {
		this.decoder.on("data", (chunk: Buffer) => {
			this.uncompressedBytes += chunk.length;
		});
		this.decoder.on("error", (error: Error) => {
			this.failure = error;
			this.pendingWrite?.(error);
		});
		this.completed = finished(this.decoder);
		void this.completed.catch(() => {});
	}

	async update(chunk: Buffer): Promise<void> {
		this.bytes += chunk.length;
		if (this.failure) throw this.failure;
		await new Promise<void>((resolve, reject) => {
			const settle = (error?: Error | null) => {
				if (this.pendingWrite === settle) this.pendingWrite = undefined;
				if (error) reject(error);
				else resolve();
			};
			this.pendingWrite = settle;
			this.decoder.write(chunk, settle);
		});
	}

	async assert(label: string): Promise<void> {
		this.decoder.end();
		await this.completed;
		if (this.uncompressedBytes === 0) throw new Error(`${label} is empty (gunzips to 0 bytes)`);
	}

	abort(): void {
		this.decoder.destroy();
	}
	get byteLength(): number {
		return this.bytes;
	}
}
