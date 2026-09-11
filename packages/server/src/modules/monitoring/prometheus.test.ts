import { describe, expect, it } from "vitest";
import {
	escapeLabelValue,
	type PrometheusSnapshot,
	renderPrometheus,
	type ServiceMetric,
} from "./prometheus";

const service = (overrides: Partial<ServiceMetric> = {}): ServiceMetric => ({
	appName: "shop",
	kind: "application",
	project: "Store",
	environment: "production",
	cpuPercent: 12.5,
	memoryBytes: 134_217_728,
	memoryLimitBytes: 536_870_912,
	up: true,
	...overrides,
});

const snapshot = (overrides: Partial<PrometheusSnapshot> = {}): PrometheusSnapshot => ({
	services: [service()],
	deploymentsByStatus: { queued: 0, running: 1, done: 12, error: 2, cancelled: 0 },
	probes: [{ probe: "shop.example.com/healthz", up: true }],
	queue: { pending: 3, running: 1 },
	...overrides,
});

const lines = (text: string): string[] => text.split("\n");

describe("escapeLabelValue", () => {
	it("escapes backslash, quote and newline — and nothing else", () => {
		expect(escapeLabelValue(String.raw`a\b`)).toBe(String.raw`a\\b`);
		expect(escapeLabelValue('say "hi"')).toBe('say \\"hi\\"');
		expect(escapeLabelValue("one\ntwo")).toBe("one\\ntwo");
		expect(escapeLabelValue("Café — prod")).toBe("Café — prod");
	});
});

describe("renderPrometheus", () => {
	it("emits HELP and TYPE before every family", () => {
		const output = renderPrometheus(snapshot());
		for (const name of [
			"nixploy_service_cpu_percent",
			"nixploy_service_memory_bytes",
			"nixploy_service_status",
			"nixploy_deployments_total",
			"nixploy_uptime_probe_up",
			"nixploy_queue_depth",
		]) {
			expect(output).toContain(`# HELP ${name} `);
			expect(output).toContain(`# TYPE ${name} `);
		}
	});

	it("labels service samples with service, kind, project and environment", () => {
		const output = renderPrometheus(snapshot());
		expect(lines(output)).toContain(
			'nixploy_service_cpu_percent{service="shop",kind="application",project="Store",environment="production"} 12.5',
		);
		expect(lines(output)).toContain(
			'nixploy_service_status{service="shop",kind="application",project="Store",environment="production"} 1',
		);
	});

	it("escapes label values that would otherwise break the format", () => {
		const output = renderPrometheus(
			snapshot({
				services: [service({ project: 'Sales "EU"', environment: String.raw`stag\ing` })],
			}),
		);
		expect(output).toContain('project="Sales \\"EU\\"",environment="stag\\\\ing"');
	});

	it("omits cpu/memory samples for services that never reported one, keeping status", () => {
		const output = renderPrometheus(
			snapshot({
				services: [
					service({
						appName: "idle",
						cpuPercent: null,
						memoryBytes: null,
						memoryLimitBytes: null,
						up: false,
					}),
				],
			}),
		);
		expect(output).not.toContain("nixploy_service_cpu_percent{");
		expect(output).toContain('nixploy_service_status{service="idle"');
		expect(output).toContain('environment="production"} 0');
	});

	it("still prints the headers of an empty fleet", () => {
		const output = renderPrometheus(
			snapshot({ services: [], probes: [], deploymentsByStatus: {} }),
		);
		expect(output).toContain("# TYPE nixploy_service_status gauge");
		expect(output).not.toContain("nixploy_service_status{");
		expect(output).toContain("# TYPE nixploy_deployments_total counter");
	});

	it("sorts deployment statuses so a diff of two scrapes is readable", () => {
		const output = renderPrometheus(snapshot());
		const statuses = lines(output)
			.filter((line) => line.startsWith("nixploy_deployments_total{"))
			.map((line) => line.replace(/^nixploy_deployments_total\{status="([^"]+)"\}.*$/, "$1"));
		expect(statuses).toEqual([...statuses].sort());
		expect(lines(output)).toContain('nixploy_deployments_total{status="error"} 2');
	});

	it("splits the queue depth into pending and running", () => {
		const output = renderPrometheus(snapshot());
		expect(lines(output)).toContain('nixploy_queue_depth{state="pending"} 3');
		expect(lines(output)).toContain('nixploy_queue_depth{state="running"} 1');
	});

	it("renders probes as 1/0", () => {
		const output = renderPrometheus(
			snapshot({
				probes: [
					{ probe: "a.example.com/", up: true },
					{ probe: "b.example.com/health", up: false },
				],
			}),
		);
		expect(lines(output)).toContain('nixploy_uptime_probe_up{probe="a.example.com/"} 1');
		expect(lines(output)).toContain('nixploy_uptime_probe_up{probe="b.example.com/health"} 0');
	});

	it("rounds float noise and ends with a newline", () => {
		const output = renderPrometheus(snapshot({ services: [service({ cpuPercent: 0.123456789 })] }));
		expect(output).toContain("} 0.1235");
		expect(output.endsWith("\n")).toBe(true);
		expect(output.endsWith("\n\n")).toBe(false);
	});

	it("never emits a bare metric name without a value", () => {
		for (const line of lines(renderPrometheus(snapshot())).filter(
			(entry) => entry && !entry.startsWith("#"),
		)) {
			expect(line).toMatch(
				/^[a-z_]+(\{.*\})? -?[\d.]+(e[+-]\d+)?$|^[a-z_]+(\{.*\})? (NaN|[+-]Inf)$/,
			);
		}
	});
});
