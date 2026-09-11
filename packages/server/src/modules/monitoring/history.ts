/**
 * Barrel for the metrics-history module. The implementation was split out of
 * this file (audit F5) and kept here as re-exports so existing importers
 * (`trpc/routers/monitoring.ts`, `apps/web/server.ts`) are unchanged:
 *
 * - `store.ts` — the append-only JSONL store, file layout and read API
 * - `sampler.ts` — the 30s Docker / SSH sampling pass and its cron
 * - `alerts.ts` — org thresholds, per-service alert rules, the pass context
 */

export { loadPassContext, type PassContext, type SampleTarget } from "./alerts";
export { initMetricsHistory, sampleAllServices } from "./sampler";
export {
	DEFAULT_METRICS_RETENTION_HOURS,
	type HistorySample,
	MAX_METRICS_RETENTION_HOURS,
	METRICS_RETENTION_MS,
	MIN_METRICS_RETENTION_HOURS,
	metricsRetentionHours,
	metricsRetentionMs,
	readLatestMetricsSample,
	readMetricsHistory,
	readServerMetricsHistory,
	type ServerHistorySample,
} from "./store";
