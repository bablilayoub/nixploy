import { describe, expect, it } from "vitest";
import {
	buildRemoteSampleCommand,
	cpuPercentBetween,
	parseByteSize,
	parseDfLine,
	parseDockerStatsJsonLine,
	parseMeminfo,
	parseProcStatCpuLine,
	parseRemoteSampleOutput,
	parseUsagePair,
	readServerMetricsConfig,
} from "./remote";

describe("parseByteSize", () => {
	it("parses binary (1024-based) units", () => {
		expect(parseByteSize("12.3MiB")).toBe(Math.round(12.3 * 1024 ** 2));
		expect(parseByteSize("2GiB")).toBe(2 * 1024 ** 3);
		expect(parseByteSize("512KiB")).toBe(512 * 1024);
	});

	it("parses metric (1000-based) units", () => {
		expect(parseByteSize("1.2kB")).toBe(1200);
		expect(parseByteSize("4.5MB")).toBe(4_500_000);
		expect(parseByteSize("0B")).toBe(0);
	});

	it("returns 0 for garbage", () => {
		expect(parseByteSize("")).toBe(0);
		expect(parseByteSize("n/a")).toBe(0);
		expect(parseByteSize("MiB")).toBe(0);
	});
});

describe("parseUsagePair", () => {
	it("splits docker stats pairs", () => {
		expect(parseUsagePair("12MiB / 2GiB")).toEqual([12 * 1024 ** 2, 2 * 1024 ** 3]);
		expect(parseUsagePair("1.2kB / 3.4kB")).toEqual([1200, 3400]);
	});
});

describe("parseProcStatCpuLine", () => {
	it("parses the aggregate cpu line", () => {
		const parsed = parseProcStatCpuLine("cpu  4705 356 584 3699 23 23 50 0 0 0");
		expect(parsed).not.toBeNull();
		expect(parsed?.idle).toBe(3699 + 23); // idle + iowait
		expect(parsed?.total).toBe(4705 + 356 + 584 + 3699 + 23 + 23 + 50);
	});

	it("rejects per-core and malformed lines", () => {
		expect(parseProcStatCpuLine("cpu0 1 2 3 4 5")).toBeNull();
		expect(parseProcStatCpuLine("")).toBeNull();
	});
});

describe("cpuPercentBetween", () => {
	it("computes busy percent from cumulative deltas", () => {
		const prev = parseProcStatCpuLine("cpu  100 0 100 800 0 0 0 0 0 0");
		const next = parseProcStatCpuLine("cpu  150 0 150 800 0 0 0 0 0 0");
		if (!prev || !next) throw new Error("parse failed");
		// 100 new busy jiffies, 0 new idle → 100%
		expect(cpuPercentBetween(prev, next)).toBe(100);
	});

	it("returns 0 when the counter did not advance", () => {
		const snap = parseProcStatCpuLine("cpu  100 0 100 800 0 0 0 0 0 0");
		if (!snap) throw new Error("parse failed");
		expect(cpuPercentBetween(snap, snap)).toBe(0);
	});
});

describe("parseMeminfo", () => {
	it("parses MemTotal/MemAvailable in kB", () => {
		const mem = parseMeminfo(
			"MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    8192000 kB\n",
		);
		expect(mem.totalBytes).toBe(16384000 * 1024);
		expect(mem.availableBytes).toBe(8192000 * 1024);
		expect(mem.usedBytes).toBe((16384000 - 8192000) * 1024);
	});

	it("falls back to MemFree when MemAvailable is absent", () => {
		const mem = parseMeminfo("MemTotal: 1024 kB\nMemFree: 512 kB\n");
		expect(mem.usedBytes).toBe(512 * 1024);
	});
});

describe("parseDfLine", () => {
	it("parses a df -Pk data line into bytes", () => {
		const disk = parseDfLine("/dev/sda1  102400  40960  61440  40% /");
		expect(disk).toEqual({
			totalBytes: 102400 * 1024,
			usedBytes: 40960 * 1024,
			availableBytes: 61440 * 1024,
		});
	});

	it("rejects the header line and empty input", () => {
		expect(parseDfLine("Filesystem 1024-blocks Used Available Use% Mounted").totalBytes).toBe(0);
		expect(parseDfLine("").totalBytes).toBe(0);
	});
});

describe("parseDockerStatsJsonLine", () => {
	it("parses a docker stats json line", () => {
		const frame = parseDockerStatsJsonLine(
			JSON.stringify({
				BlockIO: "4.1kB / 2MiB",
				CPUPerc: "12.50%",
				Container: "abc123",
				ID: "abc123",
				MemPerc: "6.25%",
				MemUsage: "128MiB / 2GiB",
				Name: "web.1.x",
				NetIO: "1.2kB / 3.4kB",
				PIDs: "7",
			}),
		);
		expect(frame).not.toBeNull();
		expect(frame?.cpu).toBe(12.5);
		expect(frame?.memoryUsed).toBe(128 * 1024 ** 2);
		expect(frame?.memoryTotal).toBe(2 * 1024 ** 3);
		expect(frame?.rx).toBe(1200);
		expect(frame?.tx).toBe(3400);
		expect(frame?.blockRead).toBe(4100);
		expect(frame?.blockWrite).toBe(2 * 1024 ** 2);
		expect(frame?.pids).toBe(7);
	});

	it("returns null for non-JSON lines", () => {
		expect(parseDockerStatsJsonLine("not json")).toBeNull();
	});
});

describe("parseRemoteSampleOutput", () => {
	const batch = [
		"==CPU_A==",
		"cpu  100 0 100 700 0 0 0 0 0 0",
		"==CPU_B==",
		"cpu  125 0 125 700 0 0 0 0 0 0",
		"==MEM==",
		"MemTotal:       8192000 kB",
		"MemAvailable:   4096000 kB",
		"==DF==",
		"/dev/sda1  204800  102400  102400  50% /",
		"==SVC==my-app",
		JSON.stringify({
			CPUPerc: "5.00%",
			MemUsage: "64MiB / 8GiB",
			NetIO: "1kB / 2kB",
			BlockIO: "0B / 0B",
			PIDs: "3",
		}),
		"==SVC==other-app",
		"==SVC==injected",
		JSON.stringify({ CPUPerc: "99.00%" }),
	].join("\n");

	it("parses host and service sections", () => {
		const result = parseRemoteSampleOutput(batch, ["my-app", "other-app"]);
		expect(result.host).not.toBeNull();
		// 50 busy jiffies of 50 total (idle unchanged) → 100%
		expect(result.host?.cpuPercent).toBe(100);
		expect(result.host?.memoryTotal).toBe(8192000 * 1024);
		expect(result.host?.memoryUsed).toBe((8192000 - 4096000) * 1024);
		expect(result.host?.diskTotal).toBe(204800 * 1024);
		expect(result.host?.diskUsed).toBe(102400 * 1024);

		const frame = result.services.get("my-app");
		expect(frame?.cpu).toBe(5);
		expect(frame?.pids).toBe(3);
		// other-app had no stats line (not running) — absent, not zeroed
		expect(result.services.has("other-app")).toBe(false);
		// unknown SVC markers are ignored (container output cannot inject)
		expect(result.services.has("injected")).toBe(false);
	});

	it("returns null host when nothing parsed", () => {
		const result = parseRemoteSampleOutput("garbage\n", ["my-app"]);
		expect(result.host).toBeNull();
		expect(result.services.size).toBe(0);
	});
});

describe("readServerMetricsConfig", () => {
	it("defaults to enabled every pass", () => {
		expect(readServerMetricsConfig(null)).toEqual({ enabled: true, intervalSeconds: 30 });
		expect(readServerMetricsConfig({})).toEqual({ enabled: true, intervalSeconds: 30 });
		expect(readServerMetricsConfig({ metrics: {} })).toEqual({
			enabled: true,
			intervalSeconds: 30,
		});
	});

	it("honors enabled and intervalSeconds", () => {
		expect(readServerMetricsConfig({ metrics: { enabled: false } }).enabled).toBe(false);
		expect(readServerMetricsConfig({ metrics: { intervalSeconds: 120 } }).intervalSeconds).toBe(
			120,
		);
		// below the cron cadence → clamped to 30
		expect(readServerMetricsConfig({ metrics: { intervalSeconds: 5 } }).intervalSeconds).toBe(30);
	});
});

describe("buildRemoteSampleCommand", () => {
	it("shell-quotes service label filters", () => {
		const command = buildRemoteSampleCommand(["my-app"]);
		expect(command).toContain("label=com.docker.swarm.service.name='my-app'");
		expect(command).toContain("==SVC==my-app");
		expect(command).toContain("docker stats --no-stream");
	});
});
