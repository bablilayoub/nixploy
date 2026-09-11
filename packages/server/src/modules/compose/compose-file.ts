/**
 * Barrel for the compose file pipeline. The implementation was split out of
 * this file (audit F5) and kept here as re-exports so existing importers
 * (`compose/service.ts`, `templates/*`, `trpc/routers/compose.ts`) are
 * unchanged:
 *
 * - `parse.ts` — YAML parse, the loose spec shape, `ComposeValidationError`
 * - `interpolate.ts` — env merge + compose-go interpolation / escaping
 * - `safety.ts` — the deny / limit lists and the hardening injection
 * - `rewrite.ts` — service renaming, network + node wiring, deploy pipeline
 */

export {
	composeEnvMap,
	escapeComposeInterpolation,
	interpolateComposeString,
	mergeEnvVars,
	renderComposeSpec,
	shouldRedactEnvValue,
} from "./interpolate";
export {
	type ComposeEnv,
	type ComposeFileSpec,
	type ComposeServiceSpec,
	ComposeValidationError,
	listComposeServices,
	parseComposeFile,
} from "./parse";
export {
	buildDeployComposeFile,
	type DeployComposeInput,
	injectNetwork,
	injectNodeConstraint,
	privateNetworkName,
	randomizeServiceNames,
} from "./rewrite";
export {
	applyComposeHardening,
	assertSafeComposeSpec,
	COMPOSE_CAP_ADD,
	COMPOSE_CAP_DROP,
	COMPOSE_LOGGING,
	COMPOSE_NOFILE_ULIMIT,
	COMPOSE_PIDS_LIMIT,
	COMPOSE_SECURITY_OPT,
	type ComposeSafetyOptions,
	hostPrivilegedComposeSafety,
} from "./safety";
