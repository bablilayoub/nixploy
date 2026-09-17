import { apiGet } from "../client.js";
import { CliError, EXIT_ERROR } from "../errors.js";
import { outputMode, printJson, printMessage } from "./output.js";

/**
 * `--wait`: block until a queued deployment finishes, then report it.
 *
 * The panel's `deployment.wait` is a long poll capped at 55 s (a proxy gives
 * up past that), so a longer `--wait-timeout` is several calls in a row rather
 * than one very patient request.
 */

/** Matches `DeploymentOutcome` in `modules/deployment/outcome.ts`. */
export interface DeploymentOutcome {
	deploymentId: string;
	status: string;
	done: boolean;
	ok: boolean;
	queuePosition: number | null;
	step: string | null;
	failingStep: string | null;
	errorMessage: string | null;
	durationMs: number | null;
	urls: string[];
	lastLogLines: string[];
	health: { running: number; desired: number; state: string } | null;
}

/** One long poll's ceiling on the panel side. */
const POLL_MS = 55_000;
export const DEFAULT_WAIT_TIMEOUT_SECONDS = 900;

/** Read the deployment id out of whatever a deploy-queueing verb returned. */
export function deploymentIdFrom(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	const value = (payload as Record<string, unknown>).deploymentId;
	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Poll until the deployment is terminal or the budget runs out. Returns the
 * last outcome seen — a timeout is "still running", not an error, and the
 * caller decides what that means.
 */
export async function waitForDeployment(
	deploymentId: string,
	timeoutSeconds: number,
): Promise<DeploymentOutcome> {
	const deadline = Date.now() + Math.max(timeoutSeconds, 0) * 1000;
	let outcome = await pollOnce(deploymentId, 0);
	let announced = false;
	while (!outcome.done && Date.now() < deadline) {
		if (!announced) {
			// One line, not a spinner: this output is as likely to land in a CI
			// log as in a terminal.
			printMessage(
				outcome.queuePosition
					? `Queued (position ${outcome.queuePosition})…`
					: "Deploying — waiting for it to finish…",
			);
			announced = true;
		}
		const remaining = deadline - Date.now();
		outcome = await pollOnce(deploymentId, Math.min(POLL_MS, Math.max(remaining, 1000)));
	}
	return outcome;
}

const pollOnce = (deploymentId: string, waitMs: number): Promise<DeploymentOutcome> =>
	apiGet<DeploymentOutcome>("deployment.wait", { deploymentId, waitMs });

/**
 * Print an outcome and fail the process when the deploy did not succeed.
 *
 * A deploy that failed must exit non-zero — the whole point of `--wait` in a
 * pipeline is that the next step does not run. A timeout exits non-zero too:
 * "I do not know yet" is not "it worked".
 */
export function reportOutcome(outcome: DeploymentOutcome): void {
	if (outputMode().json) {
		printJson(outcome);
	} else if (!outputMode().quiet) {
		printOutcomeLines(outcome);
	}

	if (outcome.ok) return;
	if (!outcome.done) {
		throw new CliError(
			`Deployment ${outcome.deploymentId} is still ${outcome.status} — the wait timed out`,
			EXIT_ERROR,
		);
	}
	throw new CliError(
		outcome.errorMessage
			? `Deployment ${outcome.status}${outcome.failingStep ? ` at step "${outcome.failingStep}"` : ""}: ${outcome.errorMessage}`
			: `Deployment ${outcome.status}`,
		EXIT_ERROR,
	);
}

function printOutcomeLines(outcome: DeploymentOutcome): void {
	const seconds = outcome.durationMs ? ` in ${Math.round(outcome.durationMs / 1000)}s` : "";
	process.stdout.write(
		outcome.ok
			? `Deployment succeeded${seconds}.\n`
			: `Deployment ${outcome.status}${outcome.failingStep ? ` at step "${outcome.failingStep}"` : ""}${seconds}.\n`,
	);
	if (outcome.errorMessage) {
		process.stdout.write(`  ${outcome.errorMessage}\n`);
	}
	if (outcome.health) {
		process.stdout.write(
			`  Tasks: ${outcome.health.running}/${outcome.health.desired} running (${outcome.health.state})\n`,
		);
	}
	for (const url of outcome.urls) {
		process.stdout.write(`  ${url}\n`);
	}
	// The tail is what someone actually needs when it failed; on success it is
	// noise they did not ask for.
	if (!outcome.ok && outcome.lastLogLines.length > 0) {
		process.stdout.write("\nLast log lines:\n");
		for (const line of outcome.lastLogLines) {
			process.stdout.write(`  ${line}\n`);
		}
	}
}
