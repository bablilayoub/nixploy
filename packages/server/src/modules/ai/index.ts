export { extractEnvEntries, isEnvLikePatch, mergeDotenv } from "./apply-patch";
export { type ApplyPatchResult, applySuggestedEnvPatch } from "./apply-suggested";
export { maybeAutoExplainOnFailure } from "./auto-explain";
export { type ChatMessage, completeChat, type LlmCompletion } from "./client";
export {
	chatAboutApplication,
	type ExplainFailureResult,
	explainAndCacheDeploymentFailure,
	explainDeploymentFailure,
} from "./explain";
export {
	appendExplanationToLog,
	readCachedExplanation,
	writeCachedExplanation,
} from "./explanation-cache";
export {
	type AiProvider,
	type AiSettings,
	getAiSettings,
	patchAiSettings,
	publicAiSettings,
} from "./settings";
