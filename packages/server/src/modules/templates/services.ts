import { parseComposeFile } from "../compose/compose-file";

/** One service from a template's compose file, shaped for the details dialog. */
export type TemplateServiceSummary = {
	name: string;
	image: string | null;
	dependsOn: string[];
	volumes: string[];
	envKeys: string[];
	/** True when this is the service the optional domain routes to. */
	isDomainTarget: boolean;
};

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function dependsOnNames(dependsOn: unknown): string[] {
	if (Array.isArray(dependsOn)) {
		return dependsOn.filter((entry): entry is string => typeof entry === "string");
	}
	if (dependsOn && typeof dependsOn === "object") {
		return Object.keys(dependsOn);
	}
	return [];
}

function volumeLabels(volumes: unknown): string[] {
	if (!Array.isArray(volumes)) return [];
	const labels: string[] = [];
	for (const entry of volumes) {
		if (typeof entry === "string") {
			labels.push(entry);
			continue;
		}
		if (entry && typeof entry === "object") {
			const record = entry as { source?: unknown; target?: unknown; type?: unknown };
			const source = asString(record.source);
			const target = asString(record.target);
			if (source && target) labels.push(`${source}:${target}`);
			else if (target) labels.push(target);
			else if (source) labels.push(source);
		}
	}
	return labels;
}

function environmentKeys(environment: unknown): string[] {
	if (Array.isArray(environment)) {
		return environment
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => entry.split("=", 1)[0] ?? entry)
			.filter(Boolean);
	}
	if (environment && typeof environment === "object") {
		return Object.keys(environment);
	}
	return [];
}

/**
 * Parse a template compose body into a stable list of service summaries used
 * by the Templates → Details dialog. `domainServiceName` marks the service
 * Traefik would route the optional domain to.
 */
export function summarizeTemplateServices(
	compose: string,
	domainServiceName?: string,
): TemplateServiceSummary[] {
	const spec = parseComposeFile(compose);
	return Object.entries(spec.services ?? {}).map(([name, service]) => ({
		name,
		image: asString(service.image),
		dependsOn: dependsOnNames(service.depends_on),
		volumes: volumeLabels(service.volumes),
		envKeys: environmentKeys(service.environment),
		isDomainTarget: domainServiceName !== undefined && name === domainServiceName,
	}));
}
