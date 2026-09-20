/**
 * Runtime log history: what services printed, kept beyond the container's
 * lifetime and searchable. `harvest.ts` collects (worker role, 30 s),
 * `store.ts` keeps hour files under `<config>/runtime-logs/<appName>/`,
 * `query.ts` is the search grammar, `format.ts` the line shapes.
 */
export type { DockerLogLine, RuntimeLogLine } from "./format";
export {
	harvestRuntimeLogs,
	initRuntimeLogHarvest,
	MAX_LINES_PER_CONTAINER_PASS,
	runtimeLogsEnabled,
} from "./harvest";
export { isEmptyQuery, type LogQuery, LogQueryError, parseLogQuery } from "./query";
export {
	effectiveRuntimeLogLimits,
	instanceRuntimeLogLimits,
	type RuntimeLogLimits,
	runtimeLogLimitsResolver,
} from "./retention";
export {
	DEFAULT_RUNTIME_LOG_MAX_MB_PER_SERVICE,
	DEFAULT_RUNTIME_LOG_RETENTION_DAYS,
	listRuntimeLogServices,
	pruneRuntimeLogs,
	type ReadRuntimeLogsResult,
	readRuntimeLogs,
	removeRuntimeLogs,
	runtimeLogMaxBytesPerService,
	runtimeLogRetentionDays,
	runtimeLogUsage,
} from "./store";
