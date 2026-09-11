import { parse } from "yaml";
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
	const spec = parse(content) as ComposeFileSpec | null;
	if (!spec || typeof spec !== "object") {
		throw badRequest("Invalid compose file: not a YAML mapping");
	}
	if (!spec.services || Object.keys(spec.services).length === 0) {
		throw badRequest("Invalid compose file: no services defined");
	}
	return spec;
}

/** Names of the services defined in a compose file. */
export function listComposeServices(content: string): string[] {
	const spec = parseComposeFile(content);
	return Object.keys(spec.services ?? {});
}
