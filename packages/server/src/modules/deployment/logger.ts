import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./paths";

/**
 * Append-only deployment log. Every chunk is:
 * 1. redacted (registered secrets never hit disk or the wire),
 * 2. written synchronously to the deployment's log file (`deployments.logPath`)
 *    so the WS file-poll follower can read new bytes immediately.
 */
export class DeploymentLogger {
	private readonly secrets: string[] = [];
	private closed = false;

	constructor(readonly logPath: string) {
		ensureDir(path.dirname(logPath));
		// Ensure the file exists so early readers don't hit ENOENT forever.
		if (!fs.existsSync(logPath)) {
			fs.writeFileSync(logPath, "");
		}
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

	/** Same redaction as the log stream — use before storing errorMessage / notifying. */
	redactForStorage(chunk: string): string {
		return this.redact(chunk);
	}

	/** Registered secrets (for combining with generic URL scrubbing). */
	listSecrets(): readonly string[] {
		return this.secrets;
	}

	write(chunk: string): void {
		if (this.closed) return;
		const out = this.redact(chunk);
		fs.appendFileSync(this.logPath, out);
	}

	/** Convenience: write a line with trailing newline. */
	line(line = ""): void {
		this.write(`${line}\n`);
	}

	close(): void {
		this.closed = true;
	}
}
