import { createHmac } from "node:crypto";
import { signingKeys } from "../../lib/encryption";
import { envKeysFromDotenv } from "../gitops/schema";
import type { SecretsPayload } from "../gitops/secrets";
import type { ImportPlan } from "./index";

const canonical = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, canonical(entry)]),
		);
	}
	return value;
};

/** HMAC includes secret values without making a password-guessing oracle in public reports. */
export const importReviewToken = (value: unknown): string =>
	createHmac("sha256", signingKeys("nixploy-import-review")[0] as Buffer)
		.update(JSON.stringify(canonical(value)))
		.digest("hex");

const OMIT = new Set([
	"composeFile",
	"dockerfile",
	"command",
	"hooks",
	"content",
	"password",
	"gitUrl",
	"swarm",
]);

/** Reports retain identities and changed field names, never executable text or embedded credentials. */
export function redactImportReview<T extends ImportPlan>(review: T): T {
	const redact = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(redact);
		if (value && typeof value === "object") {
			return Object.fromEntries(
				Object.entries(value)
					.filter(([key]) => !OMIT.has(key))
					.map(([key, entry]) => [key, redact(entry)]),
			);
		}
		return value;
	};
	return { ...review, manifest: redact(review.manifest) as T["manifest"] };
}

/** Describe exactly which dotenv groups apply can replace, without retaining values. */
export function summarizeImportValues(payload: SecretsPayload) {
	const groups: Array<{
		target: string;
		field: string;
		action: "copy" | "clear" | "preserve";
		keys: string[];
	}> = [];
	const add = (
		target: string,
		field: string,
		value: string | null | undefined,
		nullPreserves = false,
	) => {
		const keys = envKeysFromDotenv(value);
		groups.push({
			target,
			field,
			action:
				value === undefined || (nullPreserves && value === null)
					? "preserve"
					: keys.length
						? "copy"
						: "clear",
			keys,
		});
	};
	add("project", "env", payload.project.env, true);
	add("environment", "env", payload.environment.env, true);
	for (const kind of ["applications", "compose"] as const) {
		for (const [name, entry] of Object.entries(payload[kind])) {
			for (const field of ["env", "buildArgs", "previewEnv"] as const)
				add(`${kind === "applications" ? "application" : kind}/${name}`, field, entry[field]);
		}
	}
	for (const [kind, entries] of Object.entries(payload.databases)) {
		for (const [name, entry] of Object.entries(entries)) add(`${kind}/${name}`, "env", entry.env);
	}
	return groups;
}
