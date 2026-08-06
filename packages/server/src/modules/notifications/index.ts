import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import type { notificationType } from "../../db/schema";
import { environments, notifications, projects } from "../../db/schema";
import {
	customConfigSchema,
	discordConfigSchema,
	emailConfigSchema,
	gotifyConfigSchema,
	larkConfigSchema,
	mattermostConfigSchema,
	type NotifyPayload,
	ntfyConfigSchema,
	pushoverConfigSchema,
	sendCustomNotification,
	sendDiscordNotification,
	sendEmailNotification,
	sendGotifyNotification,
	sendLarkNotification,
	sendMattermostNotification,
	sendNtfyNotification,
	sendPushoverNotification,
	sendSlackNotification,
	sendTeamsNotification,
	sendTelegramNotification,
	slackConfigSchema,
	teamsConfigSchema,
	telegramConfigSchema,
} from "./providers";

export type { NotifyField, NotifyPayload } from "./providers";
export * from "./providers";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationType = (typeof notificationType.enumValues)[number];

/** Which event toggle column a platform event maps to. */
export type NotificationEvent =
	| "appDeploy"
	| "appBuildError"
	| "databaseBackup"
	| "nixployRestart"
	| "dockerCleanup"
	| "serverThreshold"
	| "serviceAlert"
	| "uptimeFlip";

/**
 * Dispatch a payload to a single notification row, using the config column
 * that matches `row.type`. Throws when the stored config fails validation.
 */
export async function dispatchToRow(
	row: Pick<NotificationRow, "type"> & Partial<NotificationRow>,
	payload: NotifyPayload,
): Promise<void> {
	switch (row.type) {
		case "slack":
			return sendSlackNotification(slackConfigSchema.parse(row.slackConfig), payload);
		case "discord":
			return sendDiscordNotification(discordConfigSchema.parse(row.discordConfig), payload);
		case "telegram":
			return sendTelegramNotification(telegramConfigSchema.parse(row.telegramConfig), payload);
		case "email":
			return sendEmailNotification(emailConfigSchema.parse(row.emailConfig), payload);
		case "gotify":
			return sendGotifyNotification(gotifyConfigSchema.parse(row.gotifyConfig), payload);
		case "ntfy":
			return sendNtfyNotification(ntfyConfigSchema.parse(row.ntfyConfig), payload);
		case "pushover":
			return sendPushoverNotification(pushoverConfigSchema.parse(row.pushoverConfig), payload);
		case "mattermost":
			return sendMattermostNotification(
				mattermostConfigSchema.parse(row.mattermostConfig),
				payload,
			);
		case "lark":
			return sendLarkNotification(larkConfigSchema.parse(row.larkConfig), payload);
		case "teams":
			return sendTeamsNotification(teamsConfigSchema.parse(row.teamsConfig), payload);
		case "custom":
			return sendCustomNotification(customConfigSchema.parse(row.customConfig), payload);
		default:
			throw new Error(`Unsupported notification type: ${row.type satisfies never}`);
	}
}

/** Load a notification row by id and dispatch to it. */
export async function notify(notificationId: string, payload: NotifyPayload): Promise<void> {
	const row = await db.query.notifications.findFirst({
		where: eq(notifications.notificationId, notificationId),
	});
	if (!row) {
		throw new Error(`Notification not found: ${notificationId}`);
	}
	await dispatchToRow(row, payload);
}

/**
 * Send a test message through an unsaved config (used by the UI "test"
 * button before the row exists) or through an existing row.
 */
export async function sendTestNotification(
	input: { notificationId: string } | (Partial<NotificationRow> & { type: NotificationType }),
): Promise<void> {
	let row: Partial<NotificationRow> & { type: NotificationType };
	if ("type" in input) {
		row = input;
	} else {
		const found = await db.query.notifications.findFirst({
			where: eq(notifications.notificationId, input.notificationId),
		});
		if (!found) {
			throw new Error(`Notification not found: ${input.notificationId}`);
		}
		row = found;
	}
	await dispatchToRow(row, {
		title: "Test Notification",
		message: "This is a test notification from Nixploy. Your channel is configured correctly.",
		fields: [
			{ name: "Channel", value: row.type },
			{ name: "Date", value: new Date().toISOString() },
		],
	});
}

/** All notification rows of an org subscribed to a given event. */
export async function getNotificationsForEvent(
	organizationId: string,
	event: NotificationEvent,
): Promise<NotificationRow[]> {
	return db.query.notifications.findMany({
		where: and(eq(notifications.organizationId, organizationId), eq(notifications[event], true)),
	});
}

/** Fan out a payload to every org channel subscribed to an event. */
export async function notifyEvent(
	organizationId: string,
	event: NotificationEvent,
	payload: NotifyPayload,
): Promise<void> {
	const rows = await getNotificationsForEvent(organizationId, event);
	const results = await Promise.allSettled(rows.map((row) => dispatchToRow(row, payload)));
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			console.error(
				`Failed to send ${event} notification via ${rows[index]?.name}:`,
				result.reason,
			);
		}
	}
}

/** Minimal shape of an application/compose row a deploy notification needs. */
export interface DeployServiceInfo {
	name: string;
	appName: string;
	environmentId: string;
}

/**
 * Called by the deploy engine when a deployment finishes. Resolves the
 * service's organization through environment → project and fans out to the
 * org's `appDeploy` (success) / `appBuildError` (failure) channels.
 */
export async function emitDeployNotification(
	service: DeployServiceInfo,
	status: "done" | "error",
	options: { errorMessage?: string | null; type?: "application" | "compose" } = {},
): Promise<void> {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, service.environmentId),
		with: { project: true },
	});
	if (!environment) {
		console.error(
			`emitDeployNotification: environment ${service.environmentId} not found for ${service.appName}`,
		);
		return;
	}
	const project = environment.project;
	if (!project) return;

	const success = status === "done";
	await notifyEvent(project.organizationId, success ? "appDeploy" : "appBuildError", {
		title: success ? "✅ Deploy Successful" : "❌ Deploy Failed",
		message: success
			? `Deployment of ${service.name} finished successfully.`
			: `Deployment of ${service.name} failed.${options.errorMessage ? ` ${options.errorMessage}` : ""}`,
		fields: [
			{ name: "Service", value: service.name },
			{ name: "App Name", value: service.appName },
			{ name: "Type", value: options.type ?? "application" },
			{ name: "Project", value: project.name },
			{ name: "Environment", value: environment.name },
			{ name: "Status", value: status },
			...(options.errorMessage ? [{ name: "Error", value: options.errorMessage }] : []),
			{ name: "Date", value: new Date().toISOString() },
		],
	});
}

/** Direct project lookup kept for callers that already know the project. */
export async function getOrganizationIdForProject(projectId: string): Promise<string | null> {
	const project = await db.query.projects.findFirst({
		where: eq(projects.projectId, projectId),
	});
	return project?.organizationId ?? null;
}
