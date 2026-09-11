import { afterEach, describe, expect, it } from "vitest";
import { setPrivateEgressAllowedForTests } from "../../utils/public-url";
import {
	sendCustomNotification,
	sendGotifyNotification,
	sendMattermostNotification,
	sendNtfyNotification,
} from "./providers";

/**
 * Egress policy of the notification providers, against the REAL guard (no
 * mocks): every case below is refused before a socket is opened, so nothing
 * here touches the network. Payload shapes live in `providers.test.ts`.
 */

const payload = { title: "t", message: "m" };

afterEach(() => {
	setPrivateEgressAllowedForTests(null);
});

describe("self-hosted providers with private egress OFF", () => {
	it("refuses a LAN gotify server", async () => {
		setPrivateEgressAllowedForTests(false);
		await expect(
			sendGotifyNotification(
				{ serverUrl: "http://192.168.1.5", appToken: "t", priority: 5 },
				payload,
			),
		).rejects.toThrow(/not allowed/);
	});

	it("refuses a LAN ntfy server", async () => {
		setPrivateEgressAllowedForTests(false);
		await expect(
			sendNtfyNotification({ serverUrl: "http://10.10.0.4", topic: "a", priority: 3 }, payload),
		).rejects.toThrow(/not allowed/);
	});

	it("refuses a loopback mattermost webhook", async () => {
		setPrivateEgressAllowedForTests(false);
		await expect(
			sendMattermostNotification({ webhookUrl: "http://127.0.0.1:8065/hooks/x" }, payload),
		).rejects.toThrow(/not allowed/);
	});
});

describe("self-hosted providers with private egress ON", () => {
	it("still refuses the Swarm overlay range as a literal", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			sendGotifyNotification({ serverUrl: "http://10.0.0.5", appToken: "t", priority: 5 }, payload),
		).rejects.toThrow(/cluster-internal/);
	});

	it("still refuses cloud metadata", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			sendNtfyNotification(
				{ serverUrl: "http://169.254.169.254", topic: "x", priority: 3 },
				payload,
			),
		).rejects.toThrow(/not allowed/);
	});

	it("still refuses a platform service name", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			sendMattermostNotification({ webhookUrl: "http://nixploy:3000/hooks/x" }, payload),
		).rejects.toThrow(/platform host/);
	});
});

describe("public-only providers", () => {
	it("refuses a plain-http custom webhook whatever the toggle says", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			sendCustomNotification({ endpoint: "http://example.com/hook" }, payload),
		).rejects.toThrow(/must be https/);
	});

	it("refuses a private custom webhook", async () => {
		setPrivateEgressAllowedForTests(true);
		await expect(
			sendCustomNotification({ endpoint: "https://192.168.1.5/hook" }, payload),
		).rejects.toThrow(/not allowed/);
	});
});
