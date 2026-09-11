import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Notification fan-out is the code that tells operators something is wrong,
 * and its payloads were unverified (ops-dx #19). One snapshot per provider
 * over a mocked egress layer: the body each vendor expects, the URL the
 * request goes to, and that a failure never echoes the channel's secret.
 *
 * The egress guard itself (`utils/public-url.ts`) is stubbed here on purpose —
 * it has its own suite; these tests are about what Nixploy sends.
 */

const outbound = vi.hoisted(() => ({
	calls: [] as Array<{ url: string; init: Record<string, unknown> }>,
	ok: true,
	status: 200,
	statusText: "OK",
}));

vi.mock("../../utils/public-url", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../utils/public-url")>();
	const target = (url: string) => ({
		url: new URL(url),
		addresses: ["203.0.113.10"],
		isPrivate: false,
	});
	return {
		...actual,
		assertPublicHttpsUrl: async (url: string) => target(url),
		assertSafeOutboundUrl: async (url: string) => target(url),
		assertSafeSmtpHostname: async () => ({
			hostname: "smtp.example.test",
			addresses: ["203.0.113.10"],
			isPrivate: false,
		}),
		assertAddressesUnchanged: async () => {},
		pinnedFetch: async (safeTarget: { url: URL }, init: Record<string, unknown>) => {
			outbound.calls.push({ url: safeTarget.url.toString(), init });
			return {
				ok: outbound.ok,
				status: outbound.status,
				statusText: outbound.statusText,
				body: "",
				headers: { get: () => null },
				text: () => "",
				json: () => ({}),
			};
		},
	};
});

import {
	sendCustomNotification,
	sendDiscordNotification,
	sendGotifyNotification,
	sendLarkNotification,
	sendMattermostNotification,
	sendNtfyNotification,
	sendPushoverNotification,
	sendSlackNotification,
	sendTeamsNotification,
	sendTelegramNotification,
} from "./providers";

const PAYLOAD = {
	title: "Deploy failed",
	message: "Deployment of api <prod> failed & rolled back.",
	fields: [
		{ name: "Service", value: "api" },
		{ name: "Environment", value: "prod" },
	],
};

const call = (index = 0) => outbound.calls[index] as { url: string; init: Record<string, unknown> };
const body = (index = 0): Record<string, unknown> => JSON.parse(String(call(index).init.body));
const headersOf = (index = 0): Record<string, string> =>
	call(index).init.headers as Record<string, string>;

beforeEach(() => {
	outbound.calls = [];
	outbound.ok = true;
	outbound.status = 200;
	outbound.statusText = "OK";
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-11T10:00:00.000Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("every webhook sender", () => {
	it("POSTs through the pinned client with a bounded timeout", async () => {
		await sendSlackNotification({ webhookUrl: "https://hooks.example.test/x" }, PAYLOAD);

		expect(call().init).toMatchObject({ method: "POST", timeoutMs: 15_000 });
		expect(headersOf()["Content-Type"]).toBe("application/json");
		// Length is set from the body so no proxy has to guess it.
		expect(headersOf()["Content-Length"]).toBe(String(Buffer.byteLength(String(call().init.body))));
	});

	it("turns a non-2xx response into an error", async () => {
		outbound.ok = false;
		outbound.status = 500;
		outbound.statusText = "Boom";

		await expect(
			sendSlackNotification({ webhookUrl: "https://hooks.example.test/x" }, PAYLOAD),
		).rejects.toThrow("Notification request failed: 500 Boom");
	});
});

describe("slack", () => {
	it("sends blocks plus a plain-text fallback, and the channel override", async () => {
		await sendSlackNotification(
			{ webhookUrl: "https://hooks.example.test/x", channel: "#ops" },
			PAYLOAD,
		);

		expect(body()).toEqual({
			channel: "#ops",
			text: "Deploy failed\nDeployment of api <prod> failed & rolled back.",
			blocks: [
				{ type: "header", text: { type: "plain_text", text: "Deploy failed", emoji: true } },
				{
					type: "section",
					text: { type: "mrkdwn", text: "Deployment of api <prod> failed & rolled back." },
				},
				{
					type: "section",
					fields: [
						{ type: "mrkdwn", text: "*Service:*\napi" },
						{ type: "mrkdwn", text: "*Environment:*\nprod" },
					],
				},
				{
					type: "context",
					elements: [{ type: "mrkdwn", text: "Nixploy • 2026-09-11T10:00:00.000Z" }],
				},
			],
		});
	});

	it("omits the channel key when the config has none", async () => {
		await sendSlackNotification({ webhookUrl: "https://hooks.example.test/x" }, PAYLOAD);
		expect(body()).not.toHaveProperty("channel");
	});
});

describe("discord", () => {
	it("sends a rich embed by default", async () => {
		await sendDiscordNotification({ webhookUrl: "https://discord.example.test/x" }, PAYLOAD);

		expect(body()).toEqual({
			embeds: [
				{
					title: "Deploy failed",
					description: "Deployment of api <prod> failed & rolled back.",
					color: 0x5865f2,
					fields: [
						{ name: "Service", value: "api", inline: true },
						{ name: "Environment", value: "prod", inline: true },
					],
					timestamp: "2026-09-11T10:00:00.000Z",
					footer: { text: "Nixploy" },
				},
			],
		});
	});

	it("falls back to markdown content when decoration is off", async () => {
		await sendDiscordNotification(
			{ webhookUrl: "https://discord.example.test/x", decoration: false },
			PAYLOAD,
		);

		expect(body()).toEqual({
			content:
				"**Deploy failed**\nDeployment of api <prod> failed & rolled back.\n**Service:** api\n**Environment:** prod",
		});
	});
});

describe("mattermost / lark / teams", () => {
	it("mattermost sends markdown with the optional channel and username", async () => {
		await sendMattermostNotification(
			{ webhookUrl: "http://mattermost.internal/hooks/x", channel: "ops", username: "nixploy" },
			PAYLOAD,
		);

		expect(body()).toEqual({
			text: "#### Deploy failed\nDeployment of api <prod> failed & rolled back.\n**Service:** api\n**Environment:** prod",
			channel: "ops",
			username: "nixploy",
		});
	});

	it("lark sends an interactive card", async () => {
		await sendLarkNotification({ webhookUrl: "https://lark.example.test/x" }, PAYLOAD);

		expect(body()).toEqual({
			msg_type: "interactive",
			card: {
				header: { title: { tag: "plain_text", content: "Deploy failed" }, template: "blue" },
				elements: [
					{
						tag: "div",
						text: {
							tag: "lark_md",
							content:
								"Deployment of api <prod> failed & rolled back.\nService: api\nEnvironment: prod",
						},
					},
				],
			},
		});
	});

	it("teams sends a MessageCard with facts", async () => {
		await sendTeamsNotification({ webhookUrl: "https://teams.example.test/x" }, PAYLOAD);

		expect(body()).toMatchObject({
			"@type": "MessageCard",
			summary: "Deploy failed",
			sections: [
				{
					activityTitle: "Deploy failed",
					facts: [
						{ name: "Service", value: "api" },
						{ name: "Environment", value: "prod" },
					],
					markdown: true,
				},
			],
		});
	});
});

describe("telegram", () => {
	it("escapes HTML in every user-controlled string", async () => {
		await sendTelegramNotification({ botToken: "bot-token", chatId: "-100" }, PAYLOAD);

		expect(call().url).toBe("https://api.telegram.org/botbot-token/sendMessage");
		expect(body()).toEqual({
			chat_id: "-100",
			// The blank spacer line is dropped by the sender's `filter(Boolean)`.
			text: "<b>Deploy failed</b>\nDeployment of api &lt;prod&gt; failed &amp; rolled back.\n<b>Service:</b> api\n<b>Environment:</b> prod",
			parse_mode: "HTML",
			disable_web_page_preview: true,
		});
	});

	it("reports a failed sendMessage without echoing the bot token", async () => {
		outbound.ok = false;
		outbound.status = 401;
		outbound.statusText = "Unauthorized";

		const failure = await sendTelegramNotification(
			{ botToken: "super-secret-token", chatId: "-100" },
			PAYLOAD,
		).catch((error: Error) => error);

		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain("Telegram sendMessage failed: 401");
		expect((failure as Error).message).not.toContain("super-secret-token");
	});
});

describe("gotify / ntfy / pushover", () => {
	it("gotify puts the app token in the query string, not the body", async () => {
		await sendGotifyNotification(
			{ serverUrl: "https://gotify.example.test/", appToken: "tok en", priority: 7 },
			PAYLOAD,
		);

		expect(call().url).toBe("https://gotify.example.test/message?token=tok%20en");
		expect(body()).toEqual({
			title: "Deploy failed",
			message:
				"Deployment of api <prod> failed & rolled back.\n\n**Service:** api\n**Environment:** prod",
			priority: 7,
		});
	});

	it("ntfy sends a plain-text body with the metadata in headers", async () => {
		await sendNtfyNotification(
			{
				serverUrl: "https://ntfy.example.test",
				topic: "nixploy alerts",
				priority: 4,
				accessToken: "tk_1",
			},
			PAYLOAD,
		);

		expect(call().url).toBe("https://ntfy.example.test/nixploy%20alerts");
		expect(headersOf()).toMatchObject({
			Title: "Deploy failed",
			Priority: "4",
			Tags: "rocket",
			"Content-Type": "text/plain; charset=utf-8",
			Authorization: "Bearer tk_1",
		});
		expect(call().init.body).toBe(
			"Deployment of api <prod> failed & rolled back.\nService: api\nEnvironment: prod",
		);
	});

	it("pushover sends HTML and prefers the configured title", async () => {
		await sendPushoverNotification(
			{ userKey: "u-1", apiToken: "a-1", priority: 1, htmlTitle: "Nixploy" },
			PAYLOAD,
		);

		expect(call().url).toBe("https://api.pushover.net/1/messages.json");
		expect(body()).toEqual({
			token: "a-1",
			user: "u-1",
			title: "Nixploy",
			message:
				"Deployment of api &lt;prod&gt; failed &amp; rolled back.<br><br><b>Service:</b> api<br><b>Environment:</b> prod",
			priority: 1,
			html: 1,
		});
	});
});

describe("custom webhook", () => {
	it("sends the normalized payload with a source marker", async () => {
		await sendCustomNotification({ endpoint: "https://hook.example.test/x" }, PAYLOAD);

		expect(body()).toEqual({
			title: "Deploy failed",
			message: "Deployment of api <prod> failed & rolled back.",
			fields: PAYLOAD.fields,
			timestamp: "2026-09-11T10:00:00.000Z",
			source: "nixploy",
		});
	});

	it("keeps tenant headers but drops hop-by-hop and content-* ones", async () => {
		await sendCustomNotification(
			{
				endpoint: "https://hook.example.test/x",
				headers: {
					"X-Api-Key": "keep-me",
					Host: "evil.example.test",
					"Content-Length": "0",
					"Content-Type": "text/plain",
					"Transfer-Encoding": "chunked",
					"Proxy-Authorization": "Basic x",
				},
			},
			PAYLOAD,
		);

		// Only the platform's own Content-* headers survive alongside the
		// tenant's non-hop-by-hop one.
		expect(Object.keys(headersOf()).sort()).toEqual([
			"Content-Length",
			"Content-Type",
			"X-Api-Key",
		]);
		expect(headersOf()["Content-Type"]).toBe("application/json");
		expect(headersOf()["X-Api-Key"]).toBe("keep-me");
	});
});
