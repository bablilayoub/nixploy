import { eq } from "drizzle-orm";
import { db } from "../../db";
import { webServerSettings } from "../../db/schema";
import { decrypt, encrypt } from "../../lib/encryption";

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
	/** Auto-run explain on failed deploys (notification path). */
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

	const next: AiSettings = {
		enabled: patch.enabled ?? current.enabled,
		provider: patch.provider ?? current.provider,
		baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl,
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
