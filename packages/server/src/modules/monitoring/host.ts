import { execAsync } from "../../utils/exec";
import { getConfigDir, shellQuote } from "../deployment/paths";
import { parseDfLine } from "./remote";

/**
 * Host-level probes for the Nixploy machine itself (not a managed server and
 * not a tenant container). Kept separate from `history.ts` so the platform
 * alert cron can read them without pulling in the whole metrics pass, and
 * from `trpc/routers/monitoring.ts` so there is no router dependency.
 */

export interface HostDiskStats {
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
	/** 0–100, or `null` when the filesystem could not be read. */
	usedPercent: number | null;
	/** The path that was measured. */
	path: string;
}

const EMPTY = (path: string): HostDiskStats => ({
	totalBytes: 0,
	usedBytes: 0,
	availableBytes: 0,
	usedPercent: null,
	path,
});

/** Percentage of a df sample, or `null` for an unreadable filesystem. */
export function diskUsedPercent(sample: { totalBytes: number; usedBytes: number }): number | null {
	if (!Number.isFinite(sample.totalBytes) || sample.totalBytes <= 0) return null;
	return (sample.usedBytes / sample.totalBytes) * 100;
}

/**
 * Disk usage of the filesystem holding `path` (default: the config dir, which
 * is where app checkouts, build caches, compose files and logs land — the
 * thing that actually fills up).
 *
 * POSIX `df -Pk` (1024-byte blocks): portable across GNU coreutils and
 * BusyBox, unlike `df -B1`. Soft-fails to zeros with `usedPercent: null` so a
 * missing `df` never produces a bogus "disk full" alert.
 */
export async function readDiskStats(path?: string): Promise<HostDiskStats> {
	const target = path ?? getConfigDir();
	try {
		const stdout = await execAsync(`df -Pk ${shellQuote(target)} 2>/dev/null | tail -n 1`, {
			timeout: 5_000,
		});
		const sample = parseDfLine(stdout);
		if (sample.totalBytes > 0) {
			return { ...sample, usedPercent: diskUsedPercent(sample), path: target };
		}
	} catch {
		// Unreadable filesystem, missing df, or a timeout — report "unknown".
	}
	return EMPTY(target);
}
