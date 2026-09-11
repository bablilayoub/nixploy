import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { members, notifications, users } from "../../db/schema";
import { isInstanceAdminRole } from "../auth/instance-admin";
import { dispatchToRow, type NotificationRow } from "./index";
import type { NotifyField, NotifyPayload } from "./providers";

/**
 * Platform (instance-level) self-alerts: disk pressure, a stalled deploy
 * queue, certificates about to expire, a platform service that is not at its
 * desired replica count, a missing instance backup.
 *
 * These say nothing about a tenant's services — they are about the box the
 * panel runs on — so they must not fan out to every organization's channels.
 *
 * **Scoping.** The `notification` table has one row per channel per
 * organization and one boolean per event. The only instance-scoped toggle
 * that exists today is `nixployRestart` ("Nixploy restarted"), which is
 * already sent to every subscribed channel regardless of org
 * ({@link emitInstanceRestartNotification}). Platform alerts reuse it, and
 * narrow it further: only channels of an organization that has at least one
 * **instance admin** member receive them. An operator who does not want them
 * turns the toggle off; a tenant organization with no instance admin never
 * sees platform internals even if it turns the toggle on.
 */
export type PlatformAlertSeverity = "warning" | "critical";

/** Stable identifier per alert family — also the cooldown key prefix. */
export type PlatformAlertKind =
	| "hostDisk"
	| "queueStalled"
	| "certExpiry"
	| "platformService"
	| "instanceBackup";

export interface PlatformAlert {
	kind: PlatformAlertKind;
	severity: PlatformAlertSeverity;
	/** One line, no secrets, no file paths — it reaches chat channels and /api/ready. */
	summary: string;
	fields?: NotifyField[];
}

const SEVERITY_ICON: Record<PlatformAlertSeverity, string> = {
	warning: "⚠️",
	critical: "🚨",
};

const KIND_LABEL: Record<PlatformAlertKind, string> = {
	hostDisk: "Disk usage",
	queueStalled: "Deploy queue stalled",
	certExpiry: "Certificate expiring",
	platformService: "Platform service degraded",
	instanceBackup: "Instance backup missing",
};

/** Human label of an alert kind (UI + payload titles). */
export const platformAlertLabel = (kind: PlatformAlertKind): string => KIND_LABEL[kind];

/**
 * Normalized channel payload for one platform alert. Every provider renders
 * the same `{ title, message, fields }` shape (see `providers.ts`), so a new
 * kind needs no per-provider code.
 */
export function buildPlatformAlertPayload(
	alert: PlatformAlert,
	options: { host?: string | null; now?: () => Date } = {},
): NotifyPayload {
	const now = options.now ?? (() => new Date());
	return {
		title: `${SEVERITY_ICON[alert.severity]} Nixploy platform: ${KIND_LABEL[alert.kind]}`,
		message: alert.summary,
		fields: [
			{ name: "Alert", value: alert.kind },
			{ name: "Severity", value: alert.severity },
			...(alert.fields ?? []),
			{ name: "Host", value: options.host ?? process.env.HOSTNAME ?? "unknown" },
			{ name: "Date", value: now().toISOString() },
		],
	};
}

/**
 * Channels subscribed to platform events (`nixployRestart`) that belong to an
 * organization with at least one instance-admin member. Two queries, no join
 * on an unindexed column: instance admins are a handful of rows.
 */
export async function getPlatformAlertChannels(): Promise<NotificationRow[]> {
	// `role` is null for plain members, so this is a small result set; the
	// comma-list parsing (and the banned check) happens in `isInstanceAdminRole`.
	const adminUsers = await db
		.select({ id: users.id, role: users.role, banned: users.banned })
		.from(users)
		.where(isNotNull(users.role));
	const adminIds = adminUsers
		.filter((row) => row.banned !== true && isInstanceAdminRole(row.role))
		.map((row) => row.id);
	if (adminIds.length === 0) return [];

	const adminMemberships = await db
		.selectDistinct({ organizationId: members.organizationId })
		.from(members)
		.where(inArray(members.userId, adminIds));
	const orgIds = adminMemberships.map((row) => row.organizationId);
	if (orgIds.length === 0) return [];

	return db.query.notifications.findMany({
		where: and(
			eq(notifications.nixployRestart, true),
			inArray(notifications.organizationId, orgIds),
		),
	});
}

/**
 * Fan a platform alert out to every instance-admin channel. Best effort: a
 * broken webhook must never abort the cron that produced the alert.
 */
export async function emitPlatformAlert(
	alert: PlatformAlert,
	options: { channels?: NotificationRow[] } = {},
): Promise<number> {
	try {
		const rows = options.channels ?? (await getPlatformAlertChannels());
		if (rows.length === 0) return 0;
		const payload = buildPlatformAlertPayload(alert);
		const results = await Promise.allSettled(rows.map((row) => dispatchToRow(row, payload)));
		for (const [index, result] of results.entries()) {
			if (result.status === "rejected") {
				console.error(
					`Failed to send platformAlert (${alert.kind}) via ${rows[index]?.name}:`,
					result.reason,
				);
			}
		}
		return results.filter((result) => result.status === "fulfilled").length;
	} catch (error) {
		console.error("emitPlatformAlert failed:", error);
		return 0;
	}
}
