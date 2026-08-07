export { extractEnvEntries, isEnvLikePatch, mergeDotenv } from "./apply-patch";
export { type ApplyPatchResult, applySuggestedEnvPatch } from "./apply-suggested";
export { maybeAutoExplainOnFailure } from "./auto-explain";
export { type ChatMessage, completeChat, type LlmCompletion } from "./client";
export {
	type CopilotTarget,
	chatAboutApplication,
	chatAboutService,
	type ExplainFailureResult,
	explainAndCacheDeploymentFailure,
	explainDeploymentFailure,
	type ProposedAction,
} from "./explain";
export {
	appendExplanationToLog,
	readCachedExplanation,
	writeCachedExplanation,
} from "./explanation-cache";
export { extractYamlDocument, generateComposeYaml, validateComposeYaml } from "./generate-compose";
export {
	type AiProvider,
	type AiSettings,
	getAiSettings,
	patchAiSettings,
	publicAiSettings,
} from "./settings";
