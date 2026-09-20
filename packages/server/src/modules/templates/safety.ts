import {
	assertSafeComposeSpec,
	type ComposeFileSpec,
	hostPrivilegedComposeSafety,
	parseComposeFile,
} from "../compose/compose-file";
import type { Template } from "./types";

/**
 * Compose safety for a catalog entry.
 *
 * A template is not a running stack: `ports:` is refused on a compose row
 * that has not opted in, but a *catalogue* entry that publishes host ports is
 * a normal thing to index — the opt-in exists, and the deploy path still
 * gates it on the instance admin. Rejecting those at index time dropped 114
 * of the ~530 entries of the blueprints catalog and told the operator
 * nothing they could act on.
 *
 * So publishing is decided by the file itself: a template whose compose has
 * `ports:` is checked *with* `allowPorts`, which runs the published-port
 * rules (no privileged port, no platform port, no host bind address, no
 * ranges) instead of a blanket refusal, and is flagged so deploying it marks
 * the stack `publishPorts`.
 */

/** Does any service of the spec publish host ports? */
function publishesHostPorts(spec: ComposeFileSpec): boolean {
	for (const service of Object.values(spec.services ?? {})) {
		if (service?.ports !== undefined && service?.ports !== null) return true;
	}
	return false;
}

export interface TemplateComposeCheck {
	/** The compose file publishes host ports; the stack needs `publishPorts`. */
	publishPorts: boolean;
}

/**
 * Run the deploy-time safety checks over a template's compose body. Throws
 * `ComposeValidationError` (or the parser's `badRequest`) with the reason,
 * exactly as a deploy would.
 */
export function checkTemplateCompose(
	compose: string,
	options: { hostPrivileged?: boolean } = {},
): TemplateComposeCheck {
	const spec = parseComposeFile(compose);
	const publishPorts = publishesHostPorts(spec);
	assertSafeComposeSpec(spec, {
		...(options.hostPrivileged ? hostPrivilegedComposeSafety() : {}),
		allowPorts: publishPorts,
	});
	return { publishPorts };
}

/**
 * Whether deploying this template needs the instance admin, read from the
 * compose body rather than the cached `publishPorts` flag — a source synced
 * by an older build has no flag, and the gate must not depend on one.
 * An unparseable body answers false; the deploy fails on it a moment later.
 */
export function templateNeedsInstanceAdmin(template: Pick<Template, "compose" | "hostPrivileged">) {
	if (template.hostPrivileged) return true;
	try {
		return publishesHostPorts(parseComposeFile(template.compose));
	} catch {
		return false;
	}
}
