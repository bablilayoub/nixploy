export { type ApplyUpdateResult, applyUpdate, clearStaleUpdateFlag } from "./apply";
export {
	checkForUpdates,
	getAppVersion,
	getRunningDigest,
	getRunningImageRef,
	NIXPLOY_SERVICE_NAME,
	type UpdateCheckResult,
} from "./check";
export {
	fetchRemoteDigest,
	normalizeDigest,
	type ParsedImageRef,
	parseImageRef,
} from "./registry";
export { initUpdateChecker, rescheduleUpdateChecker } from "./scheduler";
export {
	DEFAULT_CHECK_CRON,
	DEFAULT_UPDATE_IMAGE,
	getUpdateSettings,
	parseUpdateSettings,
	patchUpdateSettings,
	type UpdateSettings,
} from "./settings";
