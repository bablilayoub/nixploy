import { Command } from "commander";
import { apiGet, apiPublic, CLI_VERSION } from "../client.js";
import { printJson } from "../utils/output.js";

type ServerStats = {
	dockerVersion?: string;
	operatingSystem?: string;
	swarmNodeState?: string;
	containersRunning?: number;
	containers?: number;
	loadAverage?: number[];
	memory?: { usedPercent?: number; totalBytes?: number; usedBytes?: number };
	disk?: { usedPercent?: string | number; totalBytes?: number; usedBytes?: number };
};

type VersionInfo = { version?: string; commit?: string; node?: string; nextjs?: string };

type ReadinessReport = {
	ok?: boolean;
	failing?: string[];
	checks?: Record<string, { ok?: boolean; error?: string; warning?: string; latencyMs?: number }>;
};

type Check = { name: string; ok: boolean; detail: string; warning?: string };

function parsePercent(value: string | number | undefined): number {
	if (typeof value === "number") return value;
	if (!value) return 0;
	return Number.parseFloat(String(value).replace("%", "")) || 0;
}

function check(name: string, ok: boolean, detail: string, warning?: string): Check {
	return warning ? { name, ok, detail, warning } : { name, ok, detail };
}

/** Major component of a semver-ish string (`v1.2.3` → 1), `null` when unparsable. */
export function semverMajor(version: string | undefined): number | null {
	const match = /^v?(\d+)\.\d+\.\d+/.exec(version?.trim() ?? "");
	return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

/**
 * Compatibility verdict for the server/CLI pair. The REST contract follows
 * the panel's major version; a differing major is the one case where a
 * renamed procedure turns into a bare "Request failed with status 404".
 */
export function versionCheck(serverVersion: string | undefined, cliVersion: string): Check {
	if (!serverVersion) {
		return check(
			"version",
			true,
			`cli ${cliVersion} · server unknown`,
			"the panel predates /api/version — upgrade it to get compatibility checks",
		);
	}
	const detail = `server ${serverVersion} · cli ${cliVersion}`;
	const serverMajor = semverMajor(serverVersion);
	const cliMajor = semverMajor(cliVersion);
	if (serverMajor === null || cliMajor === null) {
		return check("version", true, detail);
	}
	if (serverMajor !== cliMajor) {
		return check(
			"version",
			true,
			detail,
			`major version mismatch — install @nixploy/cli ${serverMajor}.x to match the panel`,
		);
	}
	return check("version", true, detail);
}

/** Flatten `/api/ready` into doctor checks (one per platform component). */
export function readinessChecks(status: number, report: ReadinessReport | null): Check[] {
	if (status === 404) {
		return [
			check(
				"readiness",
				true,
				"n/a",
				"the panel predates /api/ready — upgrade it to get platform readiness checks",
			),
		];
	}
	if (!report?.checks) {
		return [check("readiness", status >= 200 && status < 300, `HTTP ${status}`)];
	}
	return Object.entries(report.checks).map(([name, result]) =>
		check(
			`panel:${name}`,
			result.ok !== false,
			result.error ?? (typeof result.latencyMs === "number" ? `ok (${result.latencyMs} ms)` : "ok"),
			result.warning,
		),
	);
}

export function doctorCommand(): Command {
	return new Command("doctor")
		.description("Quick health check: panel readiness, versions, Swarm, Docker, disk, host metrics")
		.option("--json", "Print raw JSON")
		.option("--server-id <id>", "Check a managed remote server instead of the host")
		.action(async (options: { json?: boolean; serverId?: string }) => {
			const checks: Check[] = [];

			// Unauthenticated platform endpoints first: they work even when the
			// API key is wrong and tell us whether the rest is worth trying.
			let serverVersion: VersionInfo | null = null;
			try {
				const [version, ready] = await Promise.all([
					apiPublic<VersionInfo>("version"),
					apiPublic<ReadinessReport>("ready"),
				]);
				serverVersion = version.status === 200 ? version.data : null;
				checks.push(versionCheck(serverVersion?.version, CLI_VERSION));
				checks.push(...readinessChecks(ready.status, ready.data));
			} catch (error) {
				checks.push(check("panel", false, error instanceof Error ? error.message : String(error)));
			}

			const query = options.serverId ? { serverId: options.serverId } : undefined;
			let stats: ServerStats | null = null;
			try {
				const [serverStats, systemInfo, nodes] = await Promise.all([
					apiGet<ServerStats>("monitoring.serverStats", query),
					apiGet<{ version?: { Server?: { Version?: string } } }>("docker.systemInfo", query ?? {}),
					apiGet<unknown[]>("docker.nodes", query ?? {}).catch(() => []),
				]);
				stats = serverStats;

				const swarmState = stats.swarmNodeState ?? "";
				const diskPct = parsePercent(stats.disk?.usedPercent);
				const memUsed = stats.memory?.usedBytes ?? 0;
				const memTotal = stats.memory?.totalBytes ?? 0;
				const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
				checks.push(
					check(
						"docker",
						Boolean(stats.dockerVersion || systemInfo.version?.Server?.Version),
						stats.dockerVersion || systemInfo.version?.Server?.Version || "unreachable",
					),
					check(
						"swarm",
						/active|ready/i.test(swarmState) || (Array.isArray(nodes) && nodes.length > 0),
						swarmState || (Array.isArray(nodes) ? `${nodes.length} node(s)` : "unknown"),
					),
					check("disk", diskPct < 90, stats.disk ? `${Math.round(diskPct)}% used` : "n/a"),
					check("memory", memPct < 95, memTotal ? `${Math.round(memPct)}% used` : "n/a"),
					check(
						"containers",
						true,
						`${stats.containersRunning ?? 0}/${stats.containers ?? 0} running`,
					),
				);
			} catch (error) {
				checks.push(check("api", false, error instanceof Error ? error.message : String(error)));
			}

			const healthy = checks.every((c) => c.ok);
			const payload = {
				ok: healthy,
				cliVersion: CLI_VERSION,
				serverVersion: serverVersion?.version ?? null,
				serverCommit: serverVersion?.commit ?? null,
				os: stats?.operatingSystem,
				loadAverage: stats?.loadAverage,
				checks,
			};

			if (options.json) {
				printJson(payload);
				return;
			}

			process.stdout.write(`Nixploy doctor — ${healthy ? "OK" : "ISSUES"}\n`);
			for (const c of checks) {
				process.stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}\n`);
				if (c.warning) {
					process.stdout.write(`    ! ${c.warning}\n`);
				}
			}
			if (!healthy) {
				process.exitCode = 1;
			}
		});
}
