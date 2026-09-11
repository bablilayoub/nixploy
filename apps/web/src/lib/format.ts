/** Shared display formatters — single source for byte, duration and date strings. */

import { format, formatDistanceToNow } from "date-fns";

/** "0 B" / "1.5 GB" — binary units, one decimal. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	const index = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
	return `${(bytes / 2 ** (10 * index)).toFixed(1)} ${units[index]}`;
}

/**
 * Deployment duration — "45s" / "3m 12s". Returns "—" when the deployment
 * never started; unfinished deployments measure up to now.
 */
export function formatDuration(
	startedAt: Date | string | null,
	finishedAt: Date | string | null,
): string {
	if (!startedAt) {
		return "—";
	}
	const start = new Date(startedAt).getTime();
	const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
	const seconds = Math.max(0, Math.round((end - start) / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Absolute timestamp — "Sep 10, 2026 14:05" (viewer's timezone, 24 h). */
export function formatDateTime(value: Date | string | number): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return format(date, "MMM d, yyyy HH:mm");
}

/** Relative timestamp — "3 hours ago" / "in 2 days". */
export function formatRelative(value: Date | string | number): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return formatDistanceToNow(date, { addSuffix: true });
}
