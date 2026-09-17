import { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, outputMode, printJson, printRaw, printRecord } from "../utils/output.js";

/**
 * Deploy Copilot from a terminal.
 *
 * Every verb here is a thin wrapper over the `ai.*` procedures, so whether
 * Copilot is configured at all, which model it uses and the `ai.use`
 * capability are all decided by the panel — the CLI only asks.
 */

interface Explanation {
	summary: string;
	rootCause: string;
	steps: string[];
	suggestedPatch: string | null;
	model?: string;
	deploymentId?: string;
}

function printExplanation(explanation: Explanation | null): void {
	if (!explanation) {
		printRaw("No explanation is cached for that deployment. Run `copilot explain` to ask.");
		return;
	}
	if (outputMode().json) {
		printJson(explanation);
		return;
	}
	printRecord({
		summary: explanation.summary,
		rootCause: explanation.rootCause,
		model: explanation.model ?? "",
	});
	if (explanation.steps.length > 0) {
		printRaw("\nSteps:");
		for (const [index, step] of explanation.steps.entries()) {
			printRaw(`  ${index + 1}. ${step}`);
		}
	}
	if (explanation.suggestedPatch) {
		printRaw("\nSuggested patch:");
		printRaw(explanation.suggestedPatch);
	}
}

export function copilotCommand(): Command {
	const copilot = new Command("copilot").description("Deploy Copilot: explain, ask, draft compose");

	addOutputOptions(
		copilot
			.command("explain")
			.description("Explain why a deployment failed (asks the model)")
			.argument("<deploymentId>", "Deployment ID")
			.option("--force", "Ignore the cached explanation and ask again"),
	).action(async (deploymentId: string, options: { force?: boolean }) => {
		const explanation = await apiPost<Explanation>("ai.explainDeployment", {
			deploymentId,
			...(options.force ? { force: true } : {}),
		});
		printExplanation(explanation);
	});

	addOutputOptions(
		copilot
			.command("explanation")
			.description("Read the cached explanation of a deployment (does not call the model)")
			.argument("<deploymentId>", "Deployment ID"),
	).action(async (deploymentId: string) => {
		printExplanation(await apiGet<Explanation | null>("ai.getExplanation", { deploymentId }));
	});

	addOutputOptions(
		copilot
			.command("ask")
			.description("Ask Copilot one question about a service")
			.argument("<question>", "What to ask")
			.option("--application-id <id>", "Application to ask about")
			.option("--compose-id <id>", "Compose service to ask about"),
	).action(async (question: string, options: { applicationId?: string; composeId?: string }) => {
		if (Boolean(options.applicationId) === Boolean(options.composeId)) {
			throw usageError("Pass exactly one of --application-id or --compose-id");
		}
		// One turn, no history: a shell invocation has no conversation to
		// carry, and pretending otherwise would just send an empty one.
		const reply = await apiPost<{ content: string; model?: string }>("ai.chat", {
			...(options.applicationId
				? { applicationId: options.applicationId }
				: { composeId: options.composeId }),
			messages: [{ role: "user", content: question }],
		});
		if (outputMode().json) {
			printJson(reply);
			return;
		}
		printRaw(reply.content);
	});

	addOutputOptions(
		copilot
			.command("compose")
			.description("Draft a docker-compose.yml from a prompt (prints it; saves nothing)")
			.argument("<prompt>", "What the stack should run"),
	).action(async (prompt: string) => {
		const result = await apiPost<{ compose: string; model?: string }>("ai.generateCompose", {
			prompt,
		});
		if (outputMode().json) {
			printJson(result);
			return;
		}
		// Raw YAML on stdout so it can be piped straight into a file.
		printRaw(result.compose);
	});

	addOutputOptions(
		copilot.command("status").description("Whether Copilot is configured, and with which model"),
	).action(async () => {
		printRecord(await apiGet<Record<string, unknown>>("ai.getSettings", {}));
	});

	return copilot;
}
