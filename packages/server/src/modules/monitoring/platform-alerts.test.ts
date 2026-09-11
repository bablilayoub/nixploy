import { describe, expect, it } from "vitest";
import {
	type AcmeCertificateEntry,
	ALERT_COOLDOWN_MS,
	DEFAULT_INSTANCE_BACKUP_ALERT_DAYS,
	evaluateCertificateAlert,
	evaluateDiskAlert,
	evaluateInstanceBackupAlert,
	evaluatePlatformAlerts,
	evaluatePlatformServiceAlert,
	evaluateQueueAlert,
	extractAcmeCertificates,
	type PlatformAlert,
	resolveDockerCleanupCron,
	resolveInstanceBackupAlertDays,
	selectAlertsToSend,
} from "./platform-alerts";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const disk = (usedPercent: number | null, total = 100 * 1024 ** 3) => ({
	usedPercent,
	totalBytes: total,
	usedBytes: usedPercent == null ? 0 : (total * usedPercent) / 100,
	availableBytes: usedPercent == null ? 0 : total - (total * usedPercent) / 100,
	path: "/etc/nixploy",
});

describe("evaluateDiskAlert", () => {
	it("stays quiet below the warning threshold", () => {
		expect(evaluateDiskAlert(disk(84.9))).toBeNull();
		expect(evaluateDiskAlert(disk(10))).toBeNull();
	});

	it("warns at 85% and escalates at 95%", () => {
		const warning = evaluateDiskAlert(disk(85));
		expect(warning?.kind).toBe("hostDisk");
		expect(warning?.severity).toBe("warning");
		expect(warning?.summary).toContain("85.0%");
		expect(evaluateDiskAlert(disk(95))?.severity).toBe("critical");
		expect(evaluateDiskAlert(disk(99.5))?.severity).toBe("critical");
	});

	it("never alerts on an unreadable filesystem", () => {
		// `df` missing / timing out must not look like a full disk.
		expect(evaluateDiskAlert(disk(null))).toBeNull();
	});
});

describe("evaluateQueueAlert", () => {
	it("is quiet with an empty queue or a fresh job", () => {
		expect(evaluateQueueAlert(null, NOW)).toBeNull();
		expect(evaluateQueueAlert(new Date(NOW - 5 * 60_000), NOW)).toBeNull();
		expect(evaluateQueueAlert(new Date(NOW - 29 * 60_000), NOW)).toBeNull();
	});

	it("fires once a job has waited 30 minutes", () => {
		const alert = evaluateQueueAlert(new Date(NOW - 45 * 60_000), NOW);
		expect(alert?.kind).toBe("queueStalled");
		expect(alert?.severity).toBe("warning");
		expect(alert?.summary).toContain("45 minutes");
	});

	it("ignores an unparseable timestamp", () => {
		expect(evaluateQueueAlert(Number.NaN, NOW)).toBeNull();
	});
});

describe("evaluateCertificateAlert", () => {
	const cert = (domain: string, days: number): AcmeCertificateEntry => ({
		domain,
		notAfter: NOW + days * DAY,
	});

	it("is quiet when everything is comfortably valid", () => {
		expect(evaluateCertificateAlert([], NOW)).toBeNull();
		expect(evaluateCertificateAlert([cert("a.test", 60), cert("b.test", 15)], NOW)).toBeNull();
	});

	it("warns inside the 14 day window and names the soonest", () => {
		const alert = evaluateCertificateAlert([cert("late.test", 13), cert("soon.test", 2)], NOW);
		expect(alert?.kind).toBe("certExpiry");
		expect(alert?.severity).toBe("warning");
		expect(alert?.summary).toContain("soon.test");
		expect(alert?.summary).toContain("2 days");
		expect(alert?.summary).toContain("+1 more");
	});

	it("escalates to critical once a certificate has expired", () => {
		const alert = evaluateCertificateAlert([cert("dead.test", -1)], NOW);
		expect(alert?.severity).toBe("critical");
		expect(alert?.summary).toContain("has expired");
	});

	it("skips certificates that could not be parsed", () => {
		expect(evaluateCertificateAlert([{ domain: "x.test", notAfter: null }], NOW)).toBeNull();
	});
});

describe("evaluatePlatformServiceAlert", () => {
	it("is quiet when every service is at its desired count", () => {
		expect(evaluatePlatformServiceAlert([])).toBeNull();
		expect(
			evaluatePlatformServiceAlert([
				{ name: "nixploy-traefik", running: 1, desired: 1 },
				{ name: "nixploy-postgres", running: 1, desired: 1 },
			]),
		).toBeNull();
	});

	it("reports every degraded service as critical", () => {
		const alert = evaluatePlatformServiceAlert([
			{ name: "nixploy-traefik", running: 0, desired: 1 },
			{ name: "nixploy-postgres", running: 1, desired: 1 },
		]);
		expect(alert?.kind).toBe("platformService");
		expect(alert?.severity).toBe("critical");
		expect(alert?.summary).toContain("nixploy-traefik 0/1");
		expect(alert?.summary).not.toContain("nixploy-postgres");
	});
});

describe("evaluateInstanceBackupAlert", () => {
	it("says so when no instance backup ever completed", () => {
		const alert = evaluateInstanceBackupAlert(null, NOW);
		expect(alert?.kind).toBe("instanceBackup");
		expect(alert?.summary).toContain("has ever completed");
	});

	it("is quiet inside the window and fires outside it", () => {
		expect(evaluateInstanceBackupAlert(new Date(NOW - 3 * DAY), NOW, 8)).toBeNull();
		const alert = evaluateInstanceBackupAlert(new Date(NOW - 12 * DAY), NOW, 8);
		expect(alert?.summary).toContain("12 days ago");
	});

	it("is fully disabled with 0 days", () => {
		expect(evaluateInstanceBackupAlert(null, NOW, 0)).toBeNull();
		expect(evaluateInstanceBackupAlert(new Date(NOW - 400 * DAY), NOW, 0)).toBeNull();
	});
});

describe("resolveInstanceBackupAlertDays", () => {
	it("defaults, accepts 0 as off and rejects junk", () => {
		expect(resolveInstanceBackupAlertDays(undefined)).toBe(DEFAULT_INSTANCE_BACKUP_ALERT_DAYS);
		expect(resolveInstanceBackupAlertDays("")).toBe(DEFAULT_INSTANCE_BACKUP_ALERT_DAYS);
		expect(resolveInstanceBackupAlertDays("0")).toBe(0);
		expect(resolveInstanceBackupAlertDays("30")).toBe(30);
		expect(resolveInstanceBackupAlertDays("-1")).toBe(DEFAULT_INSTANCE_BACKUP_ALERT_DAYS);
		expect(resolveInstanceBackupAlertDays("nope")).toBe(DEFAULT_INSTANCE_BACKUP_ALERT_DAYS);
	});
});

describe("resolveDockerCleanupCron", () => {
	it("is off unless an expression is set", () => {
		expect(resolveDockerCleanupCron(undefined)).toBeNull();
		expect(resolveDockerCleanupCron("")).toBeNull();
		expect(resolveDockerCleanupCron("  ")).toBeNull();
		expect(resolveDockerCleanupCron("0")).toBeNull();
		expect(resolveDockerCleanupCron("off")).toBeNull();
		expect(resolveDockerCleanupCron(" 0 4 * * 0 ")).toBe("0 4 * * 0");
	});
});

describe("selectAlertsToSend", () => {
	const alert = (kind: PlatformAlert["kind"], severity: PlatformAlert["severity"]) =>
		({ kind, severity, summary: `${kind}/${severity}` }) satisfies PlatformAlert;

	it("sends a first-seen alert and records its cooldown", () => {
		const result = selectAlertsToSend([alert("hostDisk", "warning")], {}, NOW);
		expect(result.send).toHaveLength(1);
		expect(result.cooldowns["hostDisk:warning"]).toBe(NOW);
	});

	it("suppresses a repeat inside the cooldown and re-fires after it", () => {
		const cooldowns = { "hostDisk:warning": NOW - 60_000 };
		expect(selectAlertsToSend([alert("hostDisk", "warning")], cooldowns, NOW).send).toHaveLength(0);
		const later = NOW + ALERT_COOLDOWN_MS;
		expect(selectAlertsToSend([alert("hostDisk", "warning")], cooldowns, later).send).toHaveLength(
			1,
		);
	});

	it("notifies immediately when a warning escalates to critical", () => {
		const cooldowns = { "hostDisk:warning": NOW - 60_000 };
		const result = selectAlertsToSend([alert("hostDisk", "critical")], cooldowns, NOW);
		expect(result.send.map((a) => a.severity)).toEqual(["critical"]);
		// The stale warning cooldown is dropped so a fallback to warning re-fires.
		expect(result.cooldowns["hostDisk:warning"]).toBeUndefined();
	});

	it("forgets cooldowns of alerts that resolved", () => {
		const result = selectAlertsToSend([], { "hostDisk:warning": NOW - 60_000 }, NOW);
		expect(result.send).toHaveLength(0);
		expect(result.cooldowns).toEqual({});
	});
});

describe("extractAcmeCertificates", () => {
	const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
	const b64 = Buffer.from(pem, "utf8").toString("base64");

	it("returns nothing for the empty file install.sh touches", () => {
		expect(extractAcmeCertificates("")).toEqual([]);
		expect(extractAcmeCertificates("not json")).toEqual([]);
		expect(extractAcmeCertificates("null")).toEqual([]);
	});

	it("pulls every resolver's certificates and decodes the PEM", () => {
		const raw = JSON.stringify({
			letsencrypt: { Certificates: [{ domain: { main: "app.test" }, certificate: b64 }] },
			"letsencrypt-dns": {
				Certificates: [{ domain: { main: "*.wild.test" }, certificate: b64 }],
			},
		});
		expect(extractAcmeCertificates(raw)).toEqual([
			{ domain: "app.test", pem },
			{ domain: "*.wild.test", pem },
		]);
	});

	it("skips entries without a domain, a payload or a PEM body", () => {
		const raw = JSON.stringify({
			letsencrypt: {
				Certificates: [
					{ domain: {}, certificate: b64 },
					{ domain: { main: "a.test" } },
					{ domain: { main: "b.test" }, certificate: Buffer.from("junk").toString("base64") },
				],
			},
			account: { Account: { Email: "ops@example.com" } },
		});
		expect(extractAcmeCertificates(raw)).toEqual([]);
	});
});

describe("evaluatePlatformAlerts", () => {
	const healthy = {
		disk: disk(20),
		oldestQueuedAt: null,
		certificates: [] as AcmeCertificateEntry[],
		services: [{ name: "nixploy-traefik", running: 1, desired: 1 }],
		lastInstanceBackupAt: new Date(NOW - DAY),
		backupAlertDays: 8,
	};

	it("returns nothing on a healthy platform", () => {
		expect(evaluatePlatformAlerts(healthy, NOW)).toEqual([]);
	});

	it("collects every firing evaluator", () => {
		const alerts = evaluatePlatformAlerts(
			{
				...healthy,
				disk: disk(97),
				oldestQueuedAt: new Date(NOW - 60 * 60_000),
				certificates: [{ domain: "app.test", notAfter: NOW + DAY }],
				services: [{ name: "nixploy-postgres", running: 0, desired: 1 }],
				lastInstanceBackupAt: null,
			},
			NOW,
		);
		expect(alerts.map((alert) => alert.kind)).toEqual([
			"hostDisk",
			"queueStalled",
			"certExpiry",
			"platformService",
			"instanceBackup",
		]);
		expect(alerts.every((alert) => alert.summary.length > 0)).toBe(true);
	});
});
