import fs from "node:fs";
import path from "node:path";
import { deploymentEvents } from "./events";
import { ensureDir } from "./paths";

/**
 * Append-only deployment log. Every chunk is:
 * 1. redacted (registered secrets never hit disk or the wire),
 * 2. written to the deployment's log file (`deployments.logPath`),
 * 3. emitted on {@link deploymentEvents} as a `log` event for the WS layer.
 */
export class DeploymentLogger {
	private readonly stream: fs.WriteStream;
	private readonly secrets: string[] = [];
	private closed = false;

	constructor(
		readonly deploymentId: string,
		readonly logPath: string,
	) {
		ensureDir(path.dirname(logPath));
		this.stream = fs.createWriteStream(logPath, { flags: "a" });
	}

	/** Register a secret (token, password, key) to scrub from all output. */
	addSecret(secret: string | null | undefined): void {
		if (secret && secret.length > 0 && !this.secrets.includes(secret)) {
			this.secrets.push(secret);
		}
	}

	private redact(chunk: string): string {
		let out = chunk;
		for (const secret of this.secrets) {
			out = out.split(secret).join("**********");
		}
		return out;
	}

	write(chunk: string): void {
		if (this.closed) return;
		const out = this.redact(chunk);
		this.stream.write(out);
		deploymentEvents.emit("log", { deploymentId: this.deploymentId, chunk: out });
	}

	/** Convenience: write a line with trailing newline. */
	line(line = ""): void {
		this.write(`${line}\n`);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await new Promise<void>((resolve) => this.stream.end(resolve));
	}
}
