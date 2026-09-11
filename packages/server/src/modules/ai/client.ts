import { preconditionFailed } from "../errors";
import { type AiProvider, type AiSettings, assertAiFetchBaseUrl } from "./settings";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LlmCompletion {
	content: string;
	model: string;
}

async function completeOpenAiCompatible(
	settings: AiSettings,
	messages: ChatMessage[],
): Promise<LlmCompletion> {
	const base = await assertAiFetchBaseUrl(settings);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (settings.apiKey) {
		headers.Authorization = `Bearer ${settings.apiKey}`;
	}

	const res = await fetch(`${base}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: settings.model,
			messages,
			temperature: 0.2,
		}),
		redirect: "error",
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) {
		throw new Error(`LLM request failed (${res.status})`);
	}
	const data = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		model?: string;
	};
	const content = data.choices?.[0]?.message?.content?.trim();
	if (!content) throw new Error("LLM returned an empty response");
	return { content, model: data.model ?? settings.model };
}

async function completeAnthropic(
	settings: AiSettings,
	messages: ChatMessage[],
): Promise<LlmCompletion> {
	if (!settings.apiKey) throw preconditionFailed("Anthropic API key is required");
	const base = await assertAiFetchBaseUrl(settings);
	const system = messages.find((m) => m.role === "system")?.content;
	const rest = messages.filter((m) => m.role !== "system");

	const res = await fetch(`${base}/v1/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": settings.apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model: settings.model,
			max_tokens: 2048,
			system: system || undefined,
			messages: rest.map((m) => ({ role: m.role, content: m.content })),
		}),
		redirect: "error",
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) {
		throw new Error(`Anthropic request failed (${res.status})`);
	}
	const data = (await res.json()) as {
		content?: Array<{ type?: string; text?: string }>;
		model?: string;
	};
	const text = data.content?.find((c) => c.type === "text")?.text?.trim();
	if (!text) throw new Error("Anthropic returned an empty response");
	return { content: text, model: data.model ?? settings.model };
}

export async function completeChat(
	settings: AiSettings,
	messages: ChatMessage[],
): Promise<LlmCompletion> {
	if (!settings.enabled) {
		throw preconditionFailed("AI Copilot is disabled — enable it in Settings → Platform");
	}
	const needsKey: AiProvider[] = ["openai", "anthropic", "openai-compatible"];
	if (needsKey.includes(settings.provider) && !settings.apiKey && settings.provider !== "ollama") {
		if (settings.provider !== "openai-compatible") {
			throw preconditionFailed("API key is required for this provider");
		}
	}

	if (settings.provider === "anthropic") {
		return completeAnthropic(settings, messages);
	}
	return completeOpenAiCompatible(settings, messages);
}
