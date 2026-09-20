import type { TemplateDomainHint, TemplateEnvVar } from "./types";

/**
 * Which hostnames a template deploy attaches from the operator's env values.
 * Import-free on purpose: the deploy dialog runs the same planner so the
 * operator sees what will be attached before pressing Deploy, and the
 * server runs it again (then validates strictly) before inserting rows.
 */

/** Mirror of `TRAEFIK_HOST_RE` in utils/validators.ts (kept import-free). */
const HOST_RE = /^(?=.{1,253}$)(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*\.?$/;

export interface PlannedTemplateDomain {
	/** The env key the host came from. */
	env: string;
	/** Lower-cased host, `*.` prefixed for a wildcard hint. */
	host: string;
	serviceName: string;
	port: number;
	https: boolean;
	wildcard: boolean;
}

/** A hostname a provider could hold and Traefik could route: two labels at least. */
export function isPlausibleHost(value: string): boolean {
	const host = value.trim().toLowerCase().replace(/\.$/, "");
	if (!HOST_RE.test(host) || /[`()|*]/.test(host)) return false;
	return host.split(".").filter(Boolean).length >= 2;
}

/**
 * Hosts to attach for `envValues`, in hint order, one per hint. A hint is
 * skipped when its value is missing, blank, still the template's own default
 * (a placeholder such as `tunnel.example.com`), not a plausible host, or a
 * duplicate of an earlier one — every skip is the operator's to notice in the
 * dialog, never an error.
 */
export function planTemplateDomains(
	template: { env: TemplateEnvVar[]; domains?: TemplateDomainHint[] },
	envValues: Record<string, string | undefined>,
): PlannedTemplateDomain[] {
	const defaults = new Map(template.env.map((entry) => [entry.key, entry.default]));
	const seen = new Set<string>();
	const planned: PlannedTemplateDomain[] = [];
	for (const hint of template.domains ?? []) {
		const raw = envValues[hint.env]?.trim() ?? "";
		if (!raw || raw === defaults.get(hint.env)?.trim()) continue;
		const base = raw.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
		if (!isPlausibleHost(base)) continue;
		const host = hint.wildcard ? `*.${base}` : base;
		if (seen.has(host)) continue;
		seen.add(host);
		planned.push({
			env: hint.env,
			host,
			serviceName: hint.serviceName,
			port: hint.port,
			https: hint.https ?? true,
			wildcard: Boolean(hint.wildcard),
		});
	}
	return planned;
}
