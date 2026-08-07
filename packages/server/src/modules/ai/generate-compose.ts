import { parseDocument } from "yaml";
import { completeChat } from "./client";
import { getAiSettings } from "./settings";

const SYSTEM = `You are a Docker Compose expert helping a self-hosted PaaS (Nixploy).
Return ONLY a valid docker-compose.yml (Compose file format version 3.x).
Rules:
- Include a top-level "services:" map with at least one service.
- Prefer public images from Docker Hub when possible.
- Do not include secrets as plain values when a placeholder env var works (e.g. \${POSTGRES_PASSWORD}).
- No markdown fences, no commentary — YAML only.`;

/** Strip optional markdown fences the model may still emit. */
export function extractYamlDocument(raw: string): string {
	const trimmed = raw.trim();
	const fenced = trimmed.match(/^```(?:ya?ml)?\s*([\s\S]*?)```$/i);
	if (fenced?.[1]) return fenced[1].trim();
	const start = trimmed.indexOf("services:");
	if (start > 0 && trimmed.slice(0, start).includes("```")) {
		const inner = trimmed.replace(/^```(?:ya?ml)?\s*/i, "").replace(/```\s*$/i, "");
		return inner.trim();
	}
	return trimmed;
}

export function validateComposeYaml(yamlText: string): { ok: true } | { ok: false; error: string } {
	try {
		const doc = parseDocument(yamlText);
		if (doc.errors.length > 0) {
			return { ok: false, error: doc.errors.map((e) => e.message).join("; ") };
		}
		const data = doc.toJSON() as unknown;
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			return { ok: false, error: "Compose file must be a YAML mapping" };
		}
		const services = (data as { services?: unknown }).services;
		if (!services || typeof services !== "object" || Array.isArray(services)) {
			return { ok: false, error: 'Compose file must define a "services" map' };
		}
		if (Object.keys(services as object).length === 0) {
			return { ok: false, error: "Compose file must include at least one service" };
		}
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Invalid YAML",
		};
	}
}

/**
 * Generate a compose YAML draft from a natural-language prompt.
 * Never deploys — caller must save via compose APIs.
 */
export async function generateComposeYaml(prompt: string): Promise<{
	composeFile: string;
	model: string;
}> {
	const settings = await getAiSettings();
	const completion = await completeChat(settings, [
		{ role: "system", content: SYSTEM },
		{
			role: "user",
			content: `Write a docker-compose.yml for this request:\n\n${prompt.trim()}`,
		},
	]);
	const composeFile = extractYamlDocument(completion.content);
	const validation = validateComposeYaml(composeFile);
	if (!validation.ok) {
		throw new Error(`Model returned invalid compose YAML: ${validation.error}`);
	}
	return { composeFile, model: completion.model };
}
