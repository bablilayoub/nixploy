import { Command } from "commander";
import { apiGet } from "../client.js";
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

function parsePercent(value: string | number | undefined): number {
	if (typeof value === "number") return value;
	if (!value) return 0;
	return Number.parseFloat(String(value).replace("%", "")) || 0;
}

function check(
	name: string,
	ok: boolean,
	detail: string,
): { name: string; ok: boolean; detail: string } {
	return { name, ok, detail };
}

export function doctorCommand(): Command {
	return new Command("doctor")
		.description("Quick health check: Swarm, Docker, disk, host metrics")
		.option("--json", "Print raw JSON")
		.option("--server-id <id>", "Check a managed remote server instead of the host")
		.action(async (options: { json?: boolean; serverId?: string }) => {
			const query = options.serverId ? { serverId: options.serverId } : undefined;
			const [stats, systemInfo, nodes] = await Promise.all([
				apiGet<ServerStats>("monitoring.serverStats", query),
				apiGet<{ version?: { Server?: { Version?: string } } }>("docker.systemInfo", query ?? {}),
				apiGet<unknown[]>("docker.nodes", query ?? {}).catch(() => []),
			]);

			const swarmState = stats.swarmNodeState ?? "";
			const diskPct = parsePercent(stats.disk?.usedPercent);
			const memUsed = stats.memory?.usedBytes ?? 0;
			const memTotal = stats.memory?.totalBytes ?? 0;
			const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
			const checks = [
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
			];

			const healthy = checks.every((c) => c.ok);
			const payload = {
				ok: healthy,
				os: stats.operatingSystem,
				loadAverage: stats.loadAverage,
				checks,
			};

			if (options.json) {
				printJson(payload);
				return;
			}

			process.stdout.write(`Nixploy doctor — ${healthy ? "OK" : "ISSUES"}\n`);
			for (const c of checks) {
				process.stdout.write(`  ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}\n`);
			}
			if (!healthy) {
				process.exitCode = 1;
			}
		});
}
