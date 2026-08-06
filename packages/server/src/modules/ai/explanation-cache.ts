import { appendFile, readFile, writeFile } from "node:fs/promises";
import { getDeploymentExplainPath } from "../deployment/paths";
import type { ExplainFailureResult } from "./explain";

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
	await writeFile(
		getDeploymentExplainPath(logPath),
		`${JSON.stringify(result, null, 2)}\n`,
		"utf8",
	);
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
