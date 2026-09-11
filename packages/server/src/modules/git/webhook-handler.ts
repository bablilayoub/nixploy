/**
 * Barrel for the git webhook pipeline. The implementation was split out of
 * this file (audit F5) and kept here as re-exports so existing importers
 * (`apps/web/src/app/api/webhooks/**`, `modules/git/index.ts`) are unchanged:
 *
 * - `providers/shared.ts` — types, header/payload helpers, webhook errors
 * - `providers/{github,gitlab,bitbucket,gitea}.ts` — verify + extract
 * - `match.ts` — watch-path globs and the pure repo→application predicates
 * - `handler.ts` — the dispatcher, provenance and the deploy enqueue
 * - `preview-flow.ts` — fork gate and the preview create/redeploy/delete flow
 * - `commit-url.ts` / `commit-link.ts` — provider commit links for a sha
 */

export {
	commitLinkSourceForApplication,
	commitLinkSourceForCompose,
	commitUrlForApplication,
	commitUrlForCompose,
} from "./commit-link";
export { buildCommitUrl, type CommitLinkSource, webRepoFromGitUrl } from "./commit-url";
export {
	type GitWebhookDispatch,
	handleGitWebhook,
	queueWebhookDeployment,
	webhookProvenance,
} from "./handler";
export {
	applicationMatchesPreviewWebhook,
	applicationMatchesWebhook,
	globCacheSize,
	type PreviewWebhookCandidate,
	type WebhookApplicationCandidate,
	type WebhookRepoContext,
	watchPathsMatch,
} from "./match";
export {
	handlePreviewWebhookForApplication,
	handlePreviewWebhookForCompose,
} from "./preview-flow";
export { isGitlabMetadataOnlyUpdate } from "./providers/gitlab";
export {
	commitSubject,
	commitUrlFromRepoHtml,
	extractPushCommit,
	type GitWebhookProvider,
	type GitWebhookResult,
	type PullRequestWebhookInfo,
	type WebhookCommit,
	WebhookIgnored,
	WebhookUnauthorized,
} from "./providers/shared";
