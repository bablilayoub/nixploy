import { appendFile, chmod, readFile, writeFile } from "node:fs/promises";
import { getDeploymentExplainPath } from "../deployment/paths";
import type { ExplainFailureResult } from "./explain";

/**
 * Owner-only. A cached explanation quotes the compose file and the tail of the
 * deployment log, so it carries whatever those carry — rendered env values,
 * connection strings, a token a build step echoed (security audit 2.12, file
 * modes). `mode` on `writeFile` only applies when the file is created, so an
 * existing 0644 cache from an older release is tightened explicitly.
 */
const CACHE_FILE_MODE = 0o600;

export async function readCachedExplanation(logPath: string): Promise<ExplainFailureResult | null> {
	try {
		const raw = await readFile(getDeploymentExplainPath(logPath), "utf8");
		const parsed = JSON.parse(raw) as ExplainFailureResult;
		if (!parsed?.summary || !parsed?.deploymentId) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function writeCachedExplanation(
	logPath: string,
	result: ExplainFailureResult,
): Promise<void> {
	const path = getDeploymentExplainPath(logPath);
	await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, {
		encoding: "utf8",
		mode: CACHE_FILE_MODE,
	});
	await chmod(path, CACHE_FILE_MODE);
}

/** Append a short Copilot block to the deploy log for operators reading the file. */
export async function appendExplanationToLog(
	logPath: string,
	result: ExplainFailureResult,
): Promise<void> {
	const lines = [
		"",
		"--- Deploy Copilot ---",
		`Model: ${result.model}`,
		`Summary: ${result.summary}`,
		`Root cause: ${result.rootCause}`,
		...(result.steps.length > 0
			? ["Steps:", ...result.steps.map((step, index) => `  ${index + 1}. ${step}`)]
			: []),
		result.suggestedPatch ? `Suggested patch:\n${result.suggestedPatch}` : null,
		"---",
		"",
	]
		.filter((line) => line !== null)
		.join("\n");
	await appendFile(logPath, lines, "utf8");
}
