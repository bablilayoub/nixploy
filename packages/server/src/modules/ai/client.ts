import type { AiProvider, AiSettings } from "./settings";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LlmCompletion {
	content: string;
	model: string;
}

function resolveBaseUrl(settings: AiSettings): string {
	if (settings.provider === "ollama") {
		return (settings.baseUrl ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
	}
	if (settings.provider === "openai-compatible") {
		if (!settings.baseUrl?.trim()) {
			throw new Error("Base URL is required for OpenAI-compatible providers");
		}
		return settings.baseUrl.replace(/\/$/, "");
	}
	if (settings.provider === "anthropic") {
		return (settings.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
	}
	return (settings.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
}

async function completeOpenAiCompatible(
	settings: AiSettings,
	messages: ChatMessage[],
): Promise<LlmCompletion> {
	const base = resolveBaseUrl(settings);
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
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 400)}`);
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
	if (!settings.apiKey) throw new Error("Anthropic API key is required");
	const base = resolveBaseUrl(settings);
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
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`Anthropic request failed (${res.status}): ${body.slice(0, 400)}`);
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
		throw new Error("AI Copilot is disabled — enable it in Settings → Server");
	}
	const needsKey: AiProvider[] = ["openai", "anthropic", "openai-compatible"];
	if (needsKey.includes(settings.provider) && !settings.apiKey && settings.provider !== "ollama") {
		if (settings.provider !== "openai-compatible") {
			throw new Error("API key is required for this provider");
		}
	}

	if (settings.provider === "anthropic") {
		return completeAnthropic(settings, messages);
	}
	return completeOpenAiCompatible(settings, messages);
}
