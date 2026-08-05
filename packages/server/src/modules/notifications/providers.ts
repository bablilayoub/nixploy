import nodemailer from "nodemailer";
import { z } from "zod";

/**
 * Notification channel providers.
 *
 * One sender per channel type. All senders accept the normalized
 * {@link NotifyPayload} and translate it into the provider's native format.
 * Webhook-based providers (slack/discord/mattermost/lark/teams/gotify/ntfy/
 * pushover/custom) are plain HTTPS POSTs; telegram uses the Bot API; email
 * goes through nodemailer (SMTP) or the Resend HTTPS API.
 */

// ── config schemas (mirrors of the `notification` table jsonb columns) ──────

export const slackConfigSchema = z.object({
	webhookUrl: z.url(),
	channel: z.string().optional(),
});

export const discordConfigSchema = z.object({
	webhookUrl: z.url(),
	/** When false, send a plain message instead of a rich embed. */
	decoration: z.boolean().optional(),
});

export const telegramConfigSchema = z.object({
	botToken: z.string().min(1),
	chatId: z.string().min(1),
});

export const emailConfigSchema = z.object({
	/** Resend API key — when set, Resend HTTPS API is used instead of SMTP. */
	resendApiKey: z.string().optional(),
	smtpServer: z.string().optional(),
	smtpPort: z.number().int().optional(),
	username: z.string().optional(),
	password: z.string().optional(),
	fromAddress: z.string().min(1),
	toAddresses: z.array(z.string().min(1)).min(1),
});

export const gotifyConfigSchema = z.object({
	serverUrl: z.url(),
	appToken: z.string().min(1),
	priority: z.number().int().min(0).max(10).default(5),
	decoration: z.boolean().optional(),
});

export const ntfyConfigSchema = z.object({
	serverUrl: z.url(),
	topic: z.string().min(1),
	accessToken: z.string().optional(),
	priority: z.number().int().min(1).max(5).default(3),
});

export const pushoverConfigSchema = z.object({
	userKey: z.string().min(1),
	apiToken: z.string().min(1),
	priority: z.number().int().min(-2).max(2).default(0),
	htmlTitle: z.string().optional(),
});

export const customConfigSchema = z.object({
	endpoint: z.url(),
	headers: z.record(z.string(), z.string()).optional(),
});

/** Incoming-webhook providers (Mattermost, Lark/Feishu, Microsoft Teams). */
export const mattermostConfigSchema = z.object({
	webhookUrl: z.url(),
	channel: z.string().optional(),
	username: z.string().optional(),
});

export const larkConfigSchema = z.object({
	webhookUrl: z.url(),
});

export const teamsConfigSchema = z.object({
	webhookUrl: z.url(),
});

export type SlackConfig = z.infer<typeof slackConfigSchema>;
export type DiscordConfig = z.infer<typeof discordConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type EmailConfig = z.infer<typeof emailConfigSchema>;
export type GotifyConfig = z.infer<typeof gotifyConfigSchema>;
export type NtfyConfig = z.infer<typeof ntfyConfigSchema>;
export type PushoverConfig = z.infer<typeof pushoverConfigSchema>;
export type CustomConfig = z.infer<typeof customConfigSchema>;
export type MattermostConfig = z.infer<typeof mattermostConfigSchema>;
export type LarkConfig = z.infer<typeof larkConfigSchema>;
export type TeamsConfig = z.infer<typeof teamsConfigSchema>;

// ── common payload ───────────────────────────────────────────────────────────

export interface NotifyField {
	name: string;
	value: string;
}

export interface NotifyPayload {
	title: string;
	message: string;
	fields?: NotifyField[];
}

const REQUEST_TIMEOUT_MS = 15_000;

async function postJson(
	url: string,
	body: unknown,
	headers: Record<string, string> = {},
): Promise<void> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`Notification request failed: ${response.status} ${response.statusText} ${text}`.trim(),
		);
	}
}

function escapeHtml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function fieldsAsMarkdown(fields: NotifyField[] | undefined, bold: (s: string) => string): string {
	return (fields ?? []).map((f) => `${bold(`${f.name}:`)} ${f.value}`).join("\n");
}

// ── slack ────────────────────────────────────────────────────────────────────

export async function sendSlackNotification(
	config: SlackConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const blocks: unknown[] = [
		{ type: "header", text: { type: "plain_text", text: title, emoji: true } },
		{ type: "section", text: { type: "mrkdwn", text: message } },
	];
	if (fields?.length) {
		blocks.push({
			type: "section",
			fields: fields.map((f) => ({ type: "mrkdwn", text: `*${f.name}:*\n${f.value}` })),
		});
	}
	blocks.push({
		type: "context",
		elements: [{ type: "mrkdwn", text: `Nixploy • ${new Date().toISOString()}` }],
	});
	await postJson(config.webhookUrl, {
		...(config.channel ? { channel: config.channel } : {}),
		text: `${title}\n${message}`,
		blocks,
	});
}

// ── discord ──────────────────────────────────────────────────────────────────

export async function sendDiscordNotification(
	config: DiscordConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	if (config.decoration === false) {
		const lines = [`**${title}**`, message, fieldsAsMarkdown(fields, (s) => `**${s}**`)]
			.filter(Boolean)
			.join("\n");
		await postJson(config.webhookUrl, { content: lines });
		return;
	}
	await postJson(config.webhookUrl, {
		embeds: [
			{
				title,
				description: message,
				color: 0x5865f2,
				fields: (fields ?? []).map((f) => ({ name: f.name, value: f.value, inline: true })),
				timestamp: new Date().toISOString(),
				footer: { text: "Nixploy" },
			},
		],
	});
}

// ── mattermost / lark / teams (incoming webhooks) ────────────────────────────

export async function sendMattermostNotification(
	config: MattermostConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const text = [`#### ${title}`, message, fieldsAsMarkdown(fields, (s) => `**${s}**`)]
		.filter(Boolean)
		.join("\n");
	await postJson(config.webhookUrl, {
		text,
		...(config.channel ? { channel: config.channel } : {}),
		...(config.username ? { username: config.username } : {}),
	});
}

export async function sendLarkNotification(
	config: LarkConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const lines = [message, (fields ?? []).map((f) => `${f.name}: ${f.value}`).join("\n")]
		.filter(Boolean)
		.join("\n");
	await postJson(config.webhookUrl, {
		msg_type: "interactive",
		card: {
			header: {
				title: { tag: "plain_text", content: title },
				template: "blue",
			},
			elements: [{ tag: "div", text: { tag: "lark_md", content: lines } }],
		},
	});
}

export async function sendTeamsNotification(
	config: TeamsConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	await postJson(config.webhookUrl, {
		"@type": "MessageCard",
		"@context": "http://schema.org/extensions",
		themeColor: "5865F2",
		summary: title,
		sections: [
			{
				activityTitle: title,
				text: message,
				facts: (fields ?? []).map((f) => ({ name: f.name, value: f.value })),
				markdown: true,
			},
		],
	});
}

// ── telegram ─────────────────────────────────────────────────────────────────

export async function sendTelegramNotification(
	config: TelegramConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const lines = [
		`<b>${escapeHtml(title)}</b>`,
		"",
		escapeHtml(message),
		fieldsAsMarkdown(
			(fields ?? []).map((f) => ({ name: escapeHtml(f.name), value: escapeHtml(f.value) })),
			(s) => `<b>${s}</b>`,
		),
	]
		.filter(Boolean)
		.join("\n");
	const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: config.chatId,
			text: lines,
			parse_mode: "HTML",
			disable_web_page_preview: true,
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Telegram sendMessage failed: ${response.status} ${text}`.trim());
	}
}

// ── email (SMTP via nodemailer, or Resend HTTPS) ─────────────────────────────

function renderEmailHtml({ title, message, fields }: NotifyPayload): string {
	const rows = (fields ?? [])
		.map(
			(f) =>
				`<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${escapeHtml(
					f.name,
				)}</td><td style="padding:4px 0">${escapeHtml(f.value)}</td></tr>`,
		)
		.join("");
	return `<!doctype html>
<html><body style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0a0a0a;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:24px;color:#e5e5e5">
    <h2 style="margin:0 0 12px;font-size:18px;color:#fafafa">${escapeHtml(title)}</h2>
    <p style="margin:0 0 16px;color:#a3a3a3;white-space:pre-wrap">${escapeHtml(message)}</p>
    ${rows ? `<table style="border-collapse:collapse;font-size:14px">${rows}</table>` : ""}
    <p style="margin:24px 0 0;font-size:12px;color:#525252">Sent by Nixploy • ${new Date().toISOString()}</p>
  </div>
</body></html>`;
}

export async function sendEmailNotification(
	config: EmailConfig,
	payload: NotifyPayload,
): Promise<void> {
	const html = renderEmailHtml(payload);
	const text = [payload.title, "", payload.message, fieldsAsMarkdown(payload.fields, (s) => s)]
		.filter(Boolean)
		.join("\n");

	if (config.resendApiKey) {
		await postJson(
			"https://api.resend.com/emails",
			{
				from: config.fromAddress,
				to: config.toAddresses,
				subject: payload.title,
				html,
				text,
			},
			{ Authorization: `Bearer ${config.resendApiKey}` },
		);
		return;
	}

	if (!config.smtpServer || !config.smtpPort) {
		throw new Error("Email notification requires either a Resend API key or SMTP server/port");
	}
	const transporter = nodemailer.createTransport({
		host: config.smtpServer,
		port: config.smtpPort,
		secure: config.smtpPort === 465,
		...(config.username ? { auth: { user: config.username, pass: config.password ?? "" } } : {}),
	});
	await transporter.sendMail({
		from: config.fromAddress,
		to: config.toAddresses.join(", "),
		subject: payload.title,
		text,
		html,
	});
}

// ── gotify ───────────────────────────────────────────────────────────────────

export async function sendGotifyNotification(
	config: GotifyConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const body = [message, fieldsAsMarkdown(fields, (s) => `**${s}**`)].filter(Boolean).join("\n\n");
	const base = config.serverUrl.replace(/\/+$/, "");
	await postJson(`${base}/message?token=${encodeURIComponent(config.appToken)}`, {
		title,
		message: body,
		priority: config.priority,
		...(config.decoration
			? { extras: { "client::display": { contentType: "text/markdown" } } }
			: {}),
	});
}

// ── ntfy ─────────────────────────────────────────────────────────────────────

export async function sendNtfyNotification(
	config: NtfyConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const body = [message, fieldsAsMarkdown(fields, (s) => s)].filter(Boolean).join("\n");
	const base = config.serverUrl.replace(/\/+$/, "");
	const headers: Record<string, string> = {
		Title: title,
		Priority: String(config.priority),
		Tags: "rocket",
		"Content-Type": "text/plain; charset=utf-8",
	};
	if (config.accessToken) {
		headers.Authorization = `Bearer ${config.accessToken}`;
	}
	const response = await fetch(`${base}/${encodeURIComponent(config.topic)}`, {
		method: "POST",
		headers,
		body,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`ntfy publish failed: ${response.status} ${text}`.trim());
	}
}

// ── pushover ─────────────────────────────────────────────────────────────────

export async function sendPushoverNotification(
	config: PushoverConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	const htmlMessage = [
		escapeHtml(message),
		(fields ?? []).map((f) => `<b>${escapeHtml(f.name)}:</b> ${escapeHtml(f.value)}`).join("<br>"),
	]
		.filter(Boolean)
		.join("<br><br>");
	await postJson("https://api.pushover.net/1/messages.json", {
		token: config.apiToken,
		user: config.userKey,
		title: config.htmlTitle || title,
		message: htmlMessage,
		priority: config.priority,
		html: 1,
	});
}

// ── custom webhook ───────────────────────────────────────────────────────────

export async function sendCustomNotification(
	config: CustomConfig,
	{ title, message, fields }: NotifyPayload,
): Promise<void> {
	await postJson(
		config.endpoint,
		{
			title,
			message,
			fields: fields ?? [],
			timestamp: new Date().toISOString(),
			source: "nixploy",
		},
		config.headers ?? {},
	);
}
