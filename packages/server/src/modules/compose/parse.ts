import { parse, YAMLParseError } from "yaml";
import { badRequest, DomainError } from "../errors";

/**
 * Compose file parsing and the loose spec shape every other compose module
 * operates on (`./interpolate.ts`, `./safety.ts`, `./rewrite.ts`).
 */

/**
 * A compose file the platform refuses to run (privileged services, host
 * binds, interpolation into dangerous keys, …). Routers map it to
 * BAD_REQUEST; the deploy worker logs it as the deployment error.
 */
export class ComposeValidationError extends DomainError {
	constructor(message: string) {
		super("BAD_REQUEST", message);
		this.name = "ComposeValidationError";
	}
}

/**
 * Loose shape of a docker-compose / stack file. Only the keys this module
 * transforms are typed; everything else is passed through untouched.
 */
export interface ComposeServiceSpec {
	networks?: string[] | Record<string, { aliases?: string[] } & Record<string, unknown>>;
	depends_on?: string[] | Record<string, unknown>;
	links?: string[];
	[key: string]: unknown;
}

export interface ComposeFileSpec {
	services?: Record<string, ComposeServiceSpec>;
	networks?: Record<string, unknown>;
	[key: string]: unknown;
}

/** Interpolation variables: the merged project → environment → service env. */
export type ComposeEnv = Readonly<Record<string, string>>;

export function parseComposeFile(content: string): ComposeFileSpec {
	let spec: ComposeFileSpec | null;
	try {
		spec = parse(content) as ComposeFileSpec | null;
	} catch (error) {
		if (!(error instanceof YAMLParseError)) throw error;
		const position = error.linePos?.[0];
		// YAML's full message includes the source line, which may contain a secret.
		throw badRequest(
			`Invalid compose YAML${position ? ` at line ${position.line}, column ${position.col}` : ""}: ${error.code.toLowerCase().replaceAll("_", " ")}`,
		);
	}
	if (!spec || typeof spec !== "object") {
		throw badRequest("Invalid compose file: not a YAML mapping");
	}
	if (!spec.services || Object.keys(spec.services).length === 0) {
		throw badRequest("Invalid compose file: no services defined");
	}
	if (typeof spec.services !== "object" || Array.isArray(spec.services)) {
		throw badRequest("Invalid compose file: services must be a YAML mapping");
	}
	for (const [name, service] of Object.entries(spec.services)) {
		if (!service || typeof service !== "object" || Array.isArray(service)) {
			throw badRequest(`Invalid compose file: service "${name}" must be a YAML mapping`);
		}
	}
	return spec;
}

/** Names of the services defined in a compose file. */
export function listComposeServices(content: string): string[] {
	const spec = parseComposeFile(content);
	return Object.keys(spec.services ?? {});
}
