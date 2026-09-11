"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

export type NotificationRow = inferRouterOutputs<AppRouter>["notification"]["all"][number];

export type NotificationType =
	| "slack"
	| "telegram"
	| "discord"
	| "email"
	| "gotify"
	| "ntfy"
	| "pushover"
	| "mattermost"
	| "lark"
	| "teams"
	| "custom";

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
	slack: "Slack",
	telegram: "Telegram",
	discord: "Discord",
	email: "Email",
	gotify: "Gotify",
	ntfy: "ntfy",
	pushover: "Pushover",
	mattermost: "Mattermost",
	lark: "Lark / Feishu",
	teams: "Microsoft Teams",
	custom: "Webhook",
};

interface FieldDef {
	key: string;
	label: string;
	placeholder?: string;
	type?: "text" | "password" | "number";
	required?: boolean;
}

const TYPE_FIELDS: Record<NotificationType, FieldDef[]> = {
	slack: [
		{
			key: "webhookUrl",
			label: "Webhook URL",
			placeholder: "https://hooks.slack.com/services/…",
			required: true,
		},
		{ key: "channel", label: "Channel (optional)", placeholder: "#deploys" },
	],
	discord: [
		{
			key: "webhookUrl",
			label: "Webhook URL",
			placeholder: "https://discord.com/api/webhooks/…",
			required: true,
		},
	],
	telegram: [
		{ key: "botToken", label: "Bot token", required: true, type: "password" },
		{ key: "chatId", label: "Chat ID", required: true },
	],
	email: [
		{ key: "fromAddress", label: "From address", required: true },
		{
			key: "toAddresses",
			label: "To addresses (comma separated)",
			required: true,
		},
		{ key: "resendApiKey", label: "Resend API key (optional)", type: "password" },
		{ key: "smtpServer", label: "SMTP server (optional)" },
		{ key: "smtpPort", label: "SMTP port (optional)", type: "number" },
		{ key: "username", label: "SMTP username (optional)" },
		{ key: "password", label: "SMTP password (optional)", type: "password" },
	],
	gotify: [
		{
			key: "serverUrl",
			label: "Server URL",
			placeholder: "https://gotify.example.com",
			required: true,
		},
		{ key: "appToken", label: "App token", required: true, type: "password" },
		{ key: "priority", label: "Priority (0-10)", type: "number" },
	],
	ntfy: [
		{
			key: "serverUrl",
			label: "Server URL",
			placeholder: "https://ntfy.sh",
			required: true,
		},
		{ key: "topic", label: "Topic", required: true },
		{ key: "accessToken", label: "Access token (optional)", type: "password" },
		{ key: "priority", label: "Priority (1-5)", type: "number" },
	],
	pushover: [
		{ key: "userKey", label: "User key", required: true },
		{ key: "apiToken", label: "API token", required: true, type: "password" },
	],
	mattermost: [
		{
			key: "webhookUrl",
			label: "Webhook URL",
			placeholder: "https://mattermost.example.com/hooks/…",
			required: true,
		},
		{ key: "channel", label: "Channel (optional)", placeholder: "town-square" },
		{ key: "username", label: "Username (optional)", placeholder: "Nixploy" },
	],
	lark: [
		{
			key: "webhookUrl",
			label: "Webhook URL",
			placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/…",
			required: true,
		},
	],
	teams: [
		{
			key: "webhookUrl",
			label: "Webhook URL",
			placeholder: "https://outlook.office.com/webhook/…",
			required: true,
		},
	],
	custom: [
		{
			key: "endpoint",
			label: "Endpoint URL",
			placeholder: "https://example.com/webhook",
			required: true,
		},
	],
};

const EVENT_TOGGLES = [
	{ key: "appDeploy", label: "App deployments" },
	{ key: "appBuildError", label: "Build errors" },
	{ key: "databaseBackup", label: "Database backups" },
	{ key: "nixployRestart", label: "Nixploy restarts" },
	{ key: "dockerCleanup", label: "Docker cleanup" },
	{ key: "serverThreshold", label: "Server thresholds" },
	{ key: "serviceAlert", label: "Per-service alerts" },
	{ key: "uptimeFlip", label: "Uptime flips" },
] as const;

function buildConfig(
	type: NotificationType,
	values: Record<string, string>,
): Record<string, unknown> {
	const v = values;
	switch (type) {
		case "slack":
			return {
				slackConfig: {
					webhookUrl: v.webhookUrl,
					...(v.channel ? { channel: v.channel } : {}),
				},
			};
		case "discord":
			return { discordConfig: { webhookUrl: v.webhookUrl } };
		case "telegram":
			return {
				telegramConfig: { botToken: v.botToken, chatId: v.chatId },
			};
		case "email":
			return {
				emailConfig: {
					fromAddress: v.fromAddress,
					toAddresses: v.toAddresses
						.split(",")
						.map((address) => address.trim())
						.filter(Boolean),
					...(v.resendApiKey ? { resendApiKey: v.resendApiKey } : {}),
					...(v.smtpServer ? { smtpServer: v.smtpServer } : {}),
					...(v.smtpPort ? { smtpPort: Number(v.smtpPort) } : {}),
					...(v.username ? { username: v.username } : {}),
					...(v.password ? { password: v.password } : {}),
				},
			};
		case "gotify":
			return {
				gotifyConfig: {
					serverUrl: v.serverUrl,
					appToken: v.appToken,
					priority: Number(v.priority) || 5,
				},
			};
		case "ntfy":
			return {
				ntfyConfig: {
					serverUrl: v.serverUrl,
					topic: v.topic,
					priority: Number(v.priority) || 3,
					...(v.accessToken ? { accessToken: v.accessToken } : {}),
				},
			};
		case "pushover":
			return {
				pushoverConfig: { userKey: v.userKey, apiToken: v.apiToken },
			};
		case "mattermost":
			return {
				mattermostConfig: {
					webhookUrl: v.webhookUrl,
					...(v.channel ? { channel: v.channel } : {}),
					...(v.username ? { username: v.username } : {}),
				},
			};
		case "lark":
			return { larkConfig: { webhookUrl: v.webhookUrl } };
		case "teams":
			return { teamsConfig: { webhookUrl: v.webhookUrl } };
		case "custom":
			return { customConfig: { endpoint: v.endpoint } };
	}
}

/**
 * The router nulls every `*Config` for callers without `secrets.read`. An
 * edit then starts with empty credential fields that must not be treated as
 * "missing" — leaving them blank keeps the stored config untouched.
 */
function isConfigRedacted(notification: NotificationRow): boolean {
	const key = `${notification.type}Config` as keyof NotificationRow;
	return notification[key] === null || notification[key] === undefined;
}

/** Flatten a channel's config jsonb back into form values (inverse of buildConfig). */
function extractValues(notification: NotificationRow): Record<string, string> {
	const asString = (value: unknown) => (value === null || value === undefined ? "" : String(value));
	switch (notification.type) {
		case "slack": {
			const config = (notification.slackConfig ?? {}) as { webhookUrl?: string; channel?: string };
			return { webhookUrl: asString(config.webhookUrl), channel: asString(config.channel) };
		}
		case "discord": {
			const config = (notification.discordConfig ?? {}) as { webhookUrl?: string };
			return { webhookUrl: asString(config.webhookUrl) };
		}
		case "telegram": {
			const config = (notification.telegramConfig ?? {}) as { botToken?: string; chatId?: string };
			return { botToken: asString(config.botToken), chatId: asString(config.chatId) };
		}
		case "email": {
			const config = (notification.emailConfig ?? {}) as {
				fromAddress?: string;
				toAddresses?: string[];
				resendApiKey?: string;
				smtpServer?: string;
				smtpPort?: number;
				username?: string;
				password?: string;
			};
			return {
				fromAddress: asString(config.fromAddress),
				toAddresses: (config.toAddresses ?? []).join(", "),
				resendApiKey: asString(config.resendApiKey),
				smtpServer: asString(config.smtpServer),
				smtpPort: asString(config.smtpPort),
				username: asString(config.username),
				password: asString(config.password),
			};
		}
		case "gotify": {
			const config = (notification.gotifyConfig ?? {}) as {
				serverUrl?: string;
				appToken?: string;
				priority?: number;
			};
			return {
				serverUrl: asString(config.serverUrl),
				appToken: asString(config.appToken),
				priority: asString(config.priority),
			};
		}
		case "ntfy": {
			const config = (notification.ntfyConfig ?? {}) as {
				serverUrl?: string;
				topic?: string;
				accessToken?: string;
				priority?: number;
			};
			return {
				serverUrl: asString(config.serverUrl),
				topic: asString(config.topic),
				accessToken: asString(config.accessToken),
				priority: asString(config.priority),
			};
		}
		case "pushover": {
			const config = (notification.pushoverConfig ?? {}) as { userKey?: string; apiToken?: string };
			return { userKey: asString(config.userKey), apiToken: asString(config.apiToken) };
		}
		case "mattermost": {
			const config = (notification.mattermostConfig ?? {}) as {
				webhookUrl?: string;
				channel?: string;
				username?: string;
			};
			return {
				webhookUrl: asString(config.webhookUrl),
				channel: asString(config.channel),
				username: asString(config.username),
			};
		}
		case "lark": {
			const config = (notification.larkConfig ?? {}) as { webhookUrl?: string };
			return { webhookUrl: asString(config.webhookUrl) };
		}
		case "teams": {
			const config = (notification.teamsConfig ?? {}) as { webhookUrl?: string };
			return { webhookUrl: asString(config.webhookUrl) };
		}
		case "custom": {
			const config = (notification.customConfig ?? {}) as { endpoint?: string };
			return { endpoint: asString(config.endpoint) };
		}
		default:
			return {};
	}
}

export function NotificationDialog({
	open,
	onOpenChange,
	editing,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When set, the dialog edits this channel instead of creating a new one. */
	editing?: NotificationRow | null;
}) {
	const trpc = useTRPC();
	const [name, setName] = useState("");
	const [type, setType] = useState<NotificationType>("slack");
	const [values, setValues] = useState<Record<string, string>>({});
	const [events, setEvents] = useState<Record<string, boolean>>({
		appDeploy: true,
		databaseBackup: true,
	});

	useEffect(() => {
		if (!open) {
			return;
		}
		if (editing) {
			setName(editing.name);
			setType(editing.type);
			setValues(extractValues(editing));
			setEvents({
				appDeploy: editing.appDeploy,
				appBuildError: editing.appBuildError,
				databaseBackup: editing.databaseBackup,
				nixployRestart: editing.nixployRestart,
				dockerCleanup: editing.dockerCleanup,
				serverThreshold: editing.serverThreshold,
				serviceAlert: editing.serviceAlert,
				uptimeFlip: editing.uptimeFlip,
			});
		} else {
			setName("");
			setType("slack");
			setValues({});
			setEvents({ appDeploy: true, databaseBackup: true });
		}
	}, [open, editing]);

	const listKey = trpc.notification.all.queryKey();
	const close = () => onOpenChange(false);

	const createMutation = useSaveMutation(trpc.notification.create.mutationOptions(), {
		successMessage: "Notification channel created",
		invalidate: [listKey],
		onSuccess: close,
	});

	const updateMutation = useSaveMutation(trpc.notification.update.mutationOptions(), {
		successMessage: "Notification channel updated",
		invalidate: [listKey],
		onSuccess: close,
	});

	const saving = createMutation.isPending || updateMutation.isPending;
	const fields = TYPE_FIELDS[type];
	const redacted = Boolean(editing && isConfigRedacted(editing));
	const anyValueEntered = fields.some((field) => values[field.key]?.trim());
	// With redacted credentials, an untouched form keeps the stored config;
	// once anything is typed the whole config is re-entered and re-validated.
	const keepStoredConfig = redacted && !anyValueEntered;
	const missingRequired = keepStoredConfig
		? false
		: fields.some((field) => field.required && !values[field.key]?.trim());

	const submit = () => {
		if (editing) {
			updateMutation.mutate({
				notificationId: editing.notificationId,
				name,
				type,
				...(keepStoredConfig ? {} : buildConfig(type, values)),
				...events,
			});
		} else {
			createMutation.mutate({
				name,
				type,
				...buildConfig(type, values),
				...events,
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{editing ? "Edit notification channel" : "Add notification channel"}
					</DialogTitle>
					<DialogDescription>
						{editing
							? "Update the channel configuration."
							: "Choose a channel type and configure it."}
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
					className="grid gap-4"
				>
					<div className="grid grid-cols-2 gap-4">
						<div className="grid gap-2">
							<Label htmlFor="notification-name">Name</Label>
							<Input
								id="notification-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Type</Label>
							<Select
								value={type}
								disabled={Boolean(editing)}
								onValueChange={(value) => {
									setType(value as NotificationType);
									setValues({});
								}}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{(Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[]).map((key) => (
										<SelectItem key={key} value={key}>
											{NOTIFICATION_TYPE_LABELS[key]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{redacted && (
						<p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
							Credentials are hidden because you cannot view secrets. Leave the fields blank to keep
							the current configuration, or re-enter every field to replace it.
						</p>
					)}

					{fields.map((field) => (
						<div key={field.key} className="grid gap-2">
							<Label htmlFor={`notification-${field.key}`}>{field.label}</Label>
							<Input
								id={`notification-${field.key}`}
								type={field.type ?? "text"}
								placeholder={field.placeholder}
								value={values[field.key] ?? ""}
								onChange={(e) =>
									setValues((prev) => ({
										...prev,
										[field.key]: e.target.value,
									}))
								}
							/>
						</div>
					))}

					<Separator />

					<div className="grid gap-2">
						<Label>Notify on</Label>
						<div className="grid grid-cols-2 gap-2">
							{EVENT_TOGGLES.map((eventToggle) => (
								<div key={eventToggle.key} className="flex items-center gap-2">
									<Checkbox
										id={`event-${eventToggle.key}`}
										checked={Boolean(events[eventToggle.key])}
										onCheckedChange={(checked) =>
											setEvents((prev) => ({
												...prev,
												[eventToggle.key]: checked === true,
											}))
										}
									/>
									<Label htmlFor={`event-${eventToggle.key}`} className="font-normal">
										{eventToggle.label}
									</Label>
								</div>
							))}
						</div>
					</div>
					<DialogFooter>
						<Button type="submit" disabled={saving || !name || missingRequired}>
							{saving && <Loader2 className="size-4 animate-spin" />}
							{editing ? "Save" : "Add channel"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
