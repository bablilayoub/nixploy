import fs from "node:fs";
import path from "node:path";
import { deploymentEvents } from "./events";
import { ensureDir } from "./paths";

/** Shortest value worth redacting; shorter strings shred the log instead. */
export const MIN_SECRET_LENGTH = 8;

const NON_SECRET_LITERALS = new Set([
	"true",
	"false",
	"yes",
	"no",
	"on",
	"off",
	"null",
	"undefined",
	"production",
	"development",
	"test",
	"localhost",
]);

/**
 * Whether a value is worth registering for redaction. Every merged env value
 * is registered by the worker, so `PORT=3000`, `DEBUG=1`, `NODE_ENV=production`
 * would otherwise turn every "3000", "1" and "production" in a build log into
 * asterisks. Short, purely numeric and boolean-ish values are never secrets.
 */
export function isRedactableSecret(value: string | null | undefined): value is string {
	if (!value) return false;
	const trimmed = value.trim();
	if (trimmed.length < MIN_SECRET_LENGTH) return false;
	if (/^[\d.,_\s-]+$/.test(trimmed)) return false;
	if (NON_SECRET_LITERALS.has(trimmed.toLowerCase())) return false;
	return true;
}

/**
 * Append-only deployment log. Every chunk is:
 * 1. redacted (registered secrets never hit disk or the wire),
 * 2. written synchronously to the deployment's log file (`deployments.logPath`),
 * 3. announced on `deploymentEvents` (`log`) when a `deploymentId` is known, so
 *    `/ws/deployment` followers wake up and read the new bytes from disk
 *    instead of polling the file.
 */
export class DeploymentLogger {
	private readonly secrets: string[] = [];
	private closed = false;

	constructor(
		readonly logPath: string,
		readonly deploymentId: string | null = null,
	) {
		ensureDir(path.dirname(logPath));
		// Ensure the file exists so early readers don't hit ENOENT forever.
		if (!fs.existsSync(logPath)) {
			fs.writeFileSync(logPath, "");
		}
	}

	/**
	 * Register a secret (token, password, key) to scrub from all output.
	 * Values below the redaction floor ({@link isRedactableSecret}) are ignored.
	 */
	addSecret(secret: string | null | undefined): void {
		if (isRedactableSecret(secret) && !this.secrets.includes(secret)) {
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
		if (this.deploymentId) {
			deploymentEvents.emit("log", { deploymentId: this.deploymentId, chunk: out });
		}
	}

	/** Convenience: write a line with trailing newline. */
	line(line = ""): void {
		this.write(`${line}\n`);
	}

	close(): void {
		this.closed = true;
	}
}
