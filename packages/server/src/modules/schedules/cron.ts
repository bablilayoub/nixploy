import schedule from "node-schedule";

/**
 * Strict cron validation. node-schedule falls back to `new Date(spec)` when
 * cron-parser rejects a string, so `"Jan 1 2030"` silently registers a
 * one-shot job instead of failing. Only 5/6-field cron expressions (plus the
 * `@hourly`-style presets cron-parser understands) are accepted here.
 */

const CRON_FIELD_RE = /^[0-9A-Za-z*,/?#LW-]+$/;
const CRON_PRESETS = new Set([
	"@yearly",
	"@annually",
	"@monthly",
	"@weekly",
	"@daily",
	"@midnight",
	"@hourly",
]);

/** Shape check only: 5 or 6 whitespace-separated cron fields, or a preset. */
export function isCronExpressionShape(spec: string): boolean {
	const trimmed = spec.trim();
	if (!trimmed) return false;
	if (CRON_PRESETS.has(trimmed.toLowerCase())) return true;
	const fields = trimmed.split(/\s+/);
	if (fields.length !== 5 && fields.length !== 6) return false;
	return fields.every((field) => CRON_FIELD_RE.test(field));
}

/** Shape check plus a node-schedule parse probe (no job is left registered). */
export function isValidCronExpression(spec: string): boolean {
	if (!isCronExpressionShape(spec)) return false;
	const probe = schedule.scheduleJob(spec.trim(), () => {});
	if (!probe) return false;
	// Belt and braces: node-schedule marks the date fallback as a one-time job.
	const oneTime = (probe as unknown as { isOneTimeJob?: boolean }).isOneTimeJob === true;
	probe.cancel();
	return !oneTime;
}
