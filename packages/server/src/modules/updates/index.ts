export {
	type ApplyUpdateResult,
	applyUpdate,
	clearStaleUpdateFlag,
	resolveStuckUpdate,
} from "./apply";
export {
	checkForUpdates,
	getAppVersion,
	getRunningDigest,
	getRunningImageRef,
	NIXPLOY_SERVICE_NAME,
	resolveTargetRelease,
	type UpdateCheckResult,
} from "./check";
export {
	evaluatePreflight,
	type PreflightCheck,
	type PreflightInputs,
	type PreflightLevel,
	runUpdatePreflight,
	type UpdatePreflight,
} from "./preflight";
export {
	assertValidImageRef,
	fetchRemoteDigest,
	normalizeDigest,
	type ParsedImageRef,
	parseImageRef,
} from "./registry";
export {
	assertVersionAllowed,
	autoUpdateAllowed,
	compareVersions,
	fetchLatestRelease,
	fetchRelease,
	imageVersionTag,
	MAX_RELEASE_NOTES_BYTES,
	NIXPLOY_REPO,
	parseVersion,
	type ReleaseInfo,
	releaseTag,
	truncateNotes,
	VERSION_PATTERN,
	withImageTag,
} from "./releases";
export { initUpdateChecker, isValidUpdateCron, rescheduleUpdateChecker } from "./scheduler";
export {
	DEFAULT_CHECK_CRON,
	DEFAULT_UPDATE_IMAGE,
	getUpdateSettings,
	parseUpdateSettings,
	patchUpdateSettings,
	type UpdateSettings,
} from "./settings";
