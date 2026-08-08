import { eq } from "drizzle-orm";
import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { decrypt, encrypt } from "../../lib/encryption";
import {
	assertPublicHttpsUrl,
	isCloudMetadataHostname,
	isLoopbackHostname,
} from "../../utils/public-url";

const EXTRAS_KEY = "webServer";

export type AiProvider = "openai" | "anthropic" | "openai-compatible" | "ollama";

export interface AiSettings {
	enabled: boolean;
	provider: AiProvider;
	/** Base URL for openai-compatible / ollama (e.g. http://host:11434/v1). */
	baseUrl: string | null;
	model: string;
	/** Decrypted API key; never returned to the client in full. */
	apiKey: string | null;
	/** Auto-run explain on failed deploys (cached beside the log + Deployments UI). */
	autoExplainOnFailure: boolean;
}

const defaults: AiSettings = {
	enabled: false,
	provider: "openai",
	baseUrl: null,
	model: "gpt-4o-mini",
	apiKey: null,
	autoExplainOnFailure: false,
};

/**
 * Block AI provider base URLs that would SSRF into link-local / private ranges.
 * Ollama may use loopback only. openai-compatible may use loopback or public https
 * (DNS-resolved). Cloud providers must be public https.
 */
export async function assertSafeAiBaseUrl(
	baseUrl: string | null,
	provider: AiProvider,
): Promise<void> {
	if (!baseUrl?.trim()) return;
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error("Invalid AI base URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("AI base URL must be http(s)");
	}
	if (isCloudMetadataHostname(parsed.hostname)) {
		throw new Error("AI base URL must not target cloud metadata");
	}
	if (isLoopbackHostname(parsed.hostname)) {
		if (provider === "ollama" || provider === "openai-compatible") {
			return;
		}
		throw new Error("AI base URL must not target loopback for cloud providers");
	}
	if (provider === "ollama") {
		throw new Error("Ollama base URL must be loopback (127.0.0.1 / localhost)");
	}
	await assertPublicHttpsUrl(baseUrl);
}

/** Re-validate before every outbound LLM call (defense in depth). */
export async function assertAiFetchBaseUrl(settings: AiSettings): Promise<string> {
	if (settings.provider === "ollama") {
		const base = (settings.baseUrl ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
		await assertSafeAiBaseUrl(base, "ollama");
		return base;
	}
	if (settings.provider === "openai-compatible") {
		if (!settings.baseUrl?.trim()) {
			throw new Error("Base URL is required for OpenAI-compatible providers");
		}
		const base = settings.baseUrl.replace(/\/$/, "");
		await assertSafeAiBaseUrl(base, "openai-compatible");
		return base;
	}
	if (settings.provider === "anthropic") {
		const base = (settings.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
		await assertSafeAiBaseUrl(base, "anthropic");
		return base;
	}
	const base = (settings.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
	await assertSafeAiBaseUrl(base, "openai");
	return base;
}

function readExtras(metricsConfig: unknown): Record<string, unknown> {
	if (typeof metricsConfig === "object" && metricsConfig !== null) {
		const extras = (metricsConfig as Record<string, unknown>)[EXTRAS_KEY];
		if (typeof extras === "object" && extras !== null) {
			return extras as Record<string, unknown>;
		}
	}
	return {};
}

function asBool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback: string | null): string | null {
	if (typeof value === "string" && value.trim()) return value.trim();
	return fallback;
}

function asProvider(value: unknown): AiProvider {
	if (
		value === "openai" ||
		value === "anthropic" ||
		value === "openai-compatible" ||
		value === "ollama"
	) {
		return value;
	}
	return defaults.provider;
}

function decryptKey(stored: string | null): string | null {
	if (!stored) return null;
	try {
		return decrypt(stored);
	} catch {
		return stored;
	}
}

export function parseAiSettings(metricsConfig: unknown): AiSettings {
	const extras = readExtras(metricsConfig);
	return {
		enabled: asBool(extras.aiEnabled, defaults.enabled),
		provider: asProvider(extras.aiProvider),
		baseUrl: asString(extras.aiBaseUrl, null),
		model: asString(extras.aiModel, defaults.model) ?? defaults.model,
		apiKey: decryptKey(asString(extras.aiApiKeyEnc, null)),
		autoExplainOnFailure: asBool(extras.aiAutoExplainOnFailure, defaults.autoExplainOnFailure),
	};
}

export async function getAiSettings(): Promise<AiSettings> {
	const [row] = await db.select().from(webServerSettings).limit(1);
	return parseAiSettings(row?.metricsConfig);
}

/** Public shape — never expose the raw API key. */
export function publicAiSettings(settings: AiSettings) {
	return {
		enabled: settings.enabled,
		provider: settings.provider,
		baseUrl: settings.baseUrl,
		model: settings.model,
		apiKeyConfigured: Boolean(settings.apiKey),
		autoExplainOnFailure: settings.autoExplainOnFailure,
	};
}

export async function patchAiSettings(
	patch: Partial<{
		enabled: boolean;
		provider: AiProvider;
		baseUrl: string | null;
		model: string;
		apiKey: string | null;
		/** Pass empty string to clear. Null/undefined leaves unchanged. */
		clearApiKey: boolean;
		autoExplainOnFailure: boolean;
	}>,
): Promise<AiSettings> {
	const [existing] = await db.select().from(webServerSettings).limit(1);
	const current = parseAiSettings(existing?.metricsConfig);

	let nextKey = current.apiKey;
	if (patch.clearApiKey) {
		nextKey = null;
	} else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
		nextKey = patch.apiKey.trim();
	}

	const nextBaseUrl = patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl;
	await assertSafeAiBaseUrl(nextBaseUrl, patch.provider ?? current.provider);

	// Changing baseUrl without supplying a new key drops the old key so it cannot
	// be silently replayed against an attacker-controlled endpoint.
	const baseUrlChanged =
		patch.baseUrl !== undefined && (patch.baseUrl ?? null) !== (current.baseUrl ?? null);
	if (baseUrlChanged && !(typeof patch.apiKey === "string" && patch.apiKey.trim())) {
		nextKey = null;
	}

	const next: AiSettings = {
		enabled: patch.enabled ?? current.enabled,
		provider: patch.provider ?? current.provider,
		baseUrl: nextBaseUrl,
		model: patch.model?.trim() || current.model,
		apiKey: nextKey,
		autoExplainOnFailure: patch.autoExplainOnFailure ?? current.autoExplainOnFailure,
	};

	const base =
		typeof existing?.metricsConfig === "object" && existing.metricsConfig !== null
			? (existing.metricsConfig as Record<string, unknown>)
			: {};
	const extras = {
		...readExtras(existing?.metricsConfig),
		aiEnabled: next.enabled,
		aiProvider: next.provider,
		aiBaseUrl: next.baseUrl,
		aiModel: next.model,
		aiApiKeyEnc: next.apiKey ? encrypt(next.apiKey) : null,
		aiAutoExplainOnFailure: next.autoExplainOnFailure,
	};
	const metricsConfig = { ...base, [EXTRAS_KEY]: extras };

	if (existing) {
		await db
			.update(webServerSettings)
			.set({ metricsConfig })
			.where(eq(webServerSettings.webServerSettingsId, existing.webServerSettingsId));
	} else {
		await db.insert(webServerSettings).values({ metricsConfig });
	}
	return next;
}
