import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Platform self-alerts are instance-level: they must reach the operator's
 * channels and nobody else's. The scoping rule (channels subscribed to the
 * instance-level toggle, in an organization that has an instance admin) is
 * the security-relevant part and is asserted here against a fake query layer.
 */

const { state, dispatchToRow } = vi.hoisted(() => ({
	state: {
		users: [] as Array<{ id: string; role: string | null; banned: boolean | null }>,
		members: [] as Array<{ userId: string; organizationId: string }>,
		notifications: [] as Array<{
			name: string;
			type: string;
			organizationId: string;
			nixployRestart: boolean;
		}>,
		/** Values the last `inArray` on the notification query saw. */
		notificationOrgFilter: [] as string[],
	},
	dispatchToRow: vi.fn(async (_row: unknown, _payload: unknown) => {}),
}));

vi.mock("./index", () => ({ dispatchToRow }));

vi.mock("drizzle-orm", () => ({
	and: (...parts: unknown[]) => ({ parts }),
	eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
	isNotNull: (column: unknown) => ({ op: "isNotNull", column }),
	inArray: (column: unknown, values: unknown[]) => ({ op: "inArray", column, values }),
}));

vi.mock("../../db/schema", () => ({
	members: { organizationId: "member.organizationId", userId: "member.userId" },
	notifications: {
		nixployRestart: "notification.nixployRestart",
		organizationId: "notification.organizationId",
	},
	users: { id: "user.id", role: "user.role", banned: "user.banned" },
}));

vi.mock("../../db", () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => state.users }) }),
		selectDistinct: () => ({
			from: () => ({
				where: async (condition: { values?: string[] }) => {
					const ids = condition.values ?? [];
					const orgs = new Set(
						state.members.filter((row) => ids.includes(row.userId)).map((r) => r.organizationId),
					);
					return [...orgs].map((organizationId) => ({ organizationId }));
				},
			}),
		}),
		query: {
			notifications: {
				findMany: async ({ where }: { where: { parts: Array<{ values?: string[] }> } }) => {
					const orgFilter = where.parts.find((part) => part.values)?.values ?? [];
					state.notificationOrgFilter = orgFilter;
					return state.notifications.filter(
						(row) => row.nixployRestart && orgFilter.includes(row.organizationId),
					);
				},
			},
		},
	},
}));

import type { NotificationRow } from "./index";
import {
	buildPlatformAlertPayload,
	emitPlatformAlert,
	getPlatformAlertChannels,
	type PlatformAlert,
	platformAlertLabel,
} from "./platform";

const alert: PlatformAlert = {
	kind: "hostDisk",
	severity: "critical",
	summary: "Disk usage on /etc/nixploy is 97.0%.",
	fields: [{ name: "Used", value: "97.0%" }],
};

beforeEach(() => {
	dispatchToRow.mockClear();
	state.users = [];
	state.members = [];
	state.notifications = [];
	state.notificationOrgFilter = [];
});

describe("buildPlatformAlertPayload", () => {
	it("renders one normalized payload every provider can send", () => {
		const payload = buildPlatformAlertPayload(alert, {
			host: "node-1",
			now: () => new Date("2026-09-11T12:00:00.000Z"),
		});
		expect(payload.title).toBe("🚨 Nixploy platform: Disk usage");
		expect(payload.message).toBe(alert.summary);
		expect(payload.fields).toEqual([
			{ name: "Alert", value: "hostDisk" },
			{ name: "Severity", value: "critical" },
			{ name: "Used", value: "97.0%" },
			{ name: "Host", value: "node-1" },
			{ name: "Date", value: "2026-09-11T12:00:00.000Z" },
		]);
	});

	it("uses a warning icon for warnings and labels every kind", () => {
		const payload = buildPlatformAlertPayload({ ...alert, severity: "warning" });
		expect(payload.title.startsWith("⚠️")).toBe(true);
		expect(platformAlertLabel("queueStalled")).toBe("Deploy queue stalled");
		expect(platformAlertLabel("instanceBackup")).toBe("Instance backup missing");
	});
});

describe("getPlatformAlertChannels", () => {
	it("returns nothing when the instance has no admin", () => {
		state.users = [{ id: "u1", role: "user", banned: false }];
		state.notifications = [
			{ name: "ops", type: "slack", organizationId: "org-a", nixployRestart: true },
		];
		return expect(getPlatformAlertChannels()).resolves.toEqual([]);
	});

	it("only returns channels of organizations that have an instance admin", async () => {
		state.users = [
			{ id: "admin", role: "admin", banned: false },
			{ id: "member", role: "user", banned: false },
		];
		state.members = [
			{ userId: "admin", organizationId: "org-admin" },
			{ userId: "member", organizationId: "org-tenant" },
		];
		state.notifications = [
			{ name: "ops", type: "slack", organizationId: "org-admin", nixployRestart: true },
			{ name: "tenant", type: "slack", organizationId: "org-tenant", nixployRestart: true },
		];
		const rows = await getPlatformAlertChannels();
		expect(rows.map((row) => row.name)).toEqual(["ops"]);
		expect(state.notificationOrgFilter).toEqual(["org-admin"]);
	});

	it("skips channels that did not opt in", async () => {
		state.users = [{ id: "admin", role: "user,admin", banned: null }];
		state.members = [{ userId: "admin", organizationId: "org-admin" }];
		state.notifications = [
			{ name: "quiet", type: "slack", organizationId: "org-admin", nixployRestart: false },
		];
		await expect(getPlatformAlertChannels()).resolves.toEqual([]);
	});

	it("ignores a banned admin", async () => {
		state.users = [{ id: "admin", role: "admin", banned: true }];
		state.members = [{ userId: "admin", organizationId: "org-admin" }];
		state.notifications = [
			{ name: "ops", type: "slack", organizationId: "org-admin", nixployRestart: true },
		];
		await expect(getPlatformAlertChannels()).resolves.toEqual([]);
	});
});

/** Only `type` is read by the dispatcher, so a partial row is enough here. */
const fakeChannels = (rows: Array<{ name: string; type: string }>): NotificationRow[] =>
	rows as unknown as NotificationRow[];

describe("emitPlatformAlert", () => {
	it("dispatches once per channel and reports the successes", async () => {
		const channels = fakeChannels([
			{ name: "a", type: "slack" },
			{ name: "b", type: "discord" },
		]);
		await expect(emitPlatformAlert(alert, { channels })).resolves.toBe(2);
		expect(dispatchToRow).toHaveBeenCalledTimes(2);
		expect(dispatchToRow.mock.calls[0]?.[1]).toMatchObject({ message: alert.summary });
	});

	it("never throws when a channel fails", async () => {
		dispatchToRow.mockRejectedValueOnce(new Error("webhook 500"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const channels = fakeChannels([
			{ name: "a", type: "slack" },
			{ name: "b", type: "slack" },
		]);
		await expect(emitPlatformAlert(alert, { channels })).resolves.toBe(1);
		errorSpy.mockRestore();
	});

	it("is a no-op with no subscribed channel", async () => {
		await expect(emitPlatformAlert(alert, { channels: [] })).resolves.toBe(0);
		expect(dispatchToRow).not.toHaveBeenCalled();
	});
});
