import type { Command } from "commander";
import { apiGet, apiPost } from "../client.js";
import { usageError } from "../errors.js";
import { addOutputOptions, printList, printResult } from "../utils/output.js";

/**
 * Domain verbs that the registry cannot express: attaching a host (the parent
 * service is one of two ids), flipping HTTPS without resending the whole row,
 * and middleware chains — `domain.saveMiddlewares` is replace-all by design
 * (one atomic Traefik rewrite), so add/remove read the chain first.
 */

export const MIDDLEWARE_KINDS = [
	"rateLimit",
	"ipAllowList",
	"headers",
	"compress",
	"forwardAuth",
	"stickyCookie",
	"maintenance",
] as const;

export type MiddlewareKind = (typeof MIDDLEWARE_KINDS)[number];

interface MiddlewareRow {
	domainMiddlewareId: string;
	kind: MiddlewareKind;
	config: unknown;
	order: number;
	enabled: boolean;
}

export function assertMiddlewareKind(value: string): MiddlewareKind {
	if (!(MIDDLEWARE_KINDS as readonly string[]).includes(value)) {
		throw usageError(
			`Unknown middleware kind "${value}". Expected: ${MIDDLEWARE_KINDS.join(", ")}`,
		);
	}
	return value as MiddlewareKind;
}

export function parseConfig(raw: string | undefined): unknown {
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		throw usageError('--config expects a JSON object, e.g. \'{"average":100,"burst":50}\'');
	}
}

/** Strip the ids the replace-all procedure does not accept. */
export function toSaveShape(rows: MiddlewareRow[]): Array<{
	kind: MiddlewareKind;
	config: unknown;
	enabled: boolean;
}> {
	return rows.map((row) => ({ kind: row.kind, config: row.config, enabled: row.enabled }));
}

export function augmentDomainCommand(domain: Command): Command {
	addOutputOptions(
		domain
			.command("add")
			.description("Attach a domain to an application, a compose service or an external upstream")
			.argument("<host>", "FQDN, e.g. app.example.com")
			.option("--application-id <id>", "Application to route to")
			.option("--compose-id <id>", "Compose service to route to")
			.option("--upstream-id <id>", "External upstream to route to (HTTP only, no --port)")
			.option("--service-name <name>", "Compose only: which compose-file service to route to")
			.option("--path <path>", "URL path prefix (default /)")
			.option("--internal-path <path>", "Path rewritten before reaching the container")
			.option("--port <port>", "Container port to route to")
			.option("--https", "Terminate TLS for this host")
			.option("--no-https", "Serve plain HTTP (default)")
			.option(
				"--certificate-type <type>",
				"letsencrypt | none | custom (default: letsencrypt with --https)",
			)
			.option("--certificate-id <id>", "Custom certificate ID"),
	).action(
		async (
			host: string,
			options: {
				applicationId?: string;
				composeId?: string;
				upstreamId?: string;
				serviceName?: string;
				path?: string;
				internalPath?: string;
				port?: string;
				https?: boolean;
				certificateType?: string;
				certificateId?: string;
			},
		) => {
			const targets = [options.applicationId, options.composeId, options.upstreamId].filter(
				Boolean,
			);
			if (targets.length !== 1) {
				throw usageError("Provide exactly one of --application-id, --compose-id or --upstream-id");
			}
			const port = options.port ? Number(options.port) : undefined;
			if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
				throw usageError("--port expects an integer between 1 and 65535");
			}
			const https = options.https === true;
			const created = await apiPost<{ domainId: string; host: string }>("domain.create", {
				host,
				applicationId: options.applicationId,
				composeId: options.composeId,
				externalUpstreamId: options.upstreamId,
				serviceName: options.serviceName ?? null,
				path: options.path,
				internalPath: options.internalPath ?? null,
				port,
				https,
				certificateType: options.certificateType ?? (https ? "letsencrypt" : "none"),
				certificateId: options.certificateId ?? null,
			});
			printResult(created, `Domain ${created.host} attached (${created.domainId}).`);
		},
	);

	addOutputOptions(
		domain
			.command("set-https")
			.description("Turn TLS on or off for one domain and re-sync Traefik")
			.argument("<domainId>", "Domain ID")
			.option("--enabled <bool>", "true | false", "true")
			.option("--certificate-type <type>", "letsencrypt | none | custom")
			.option("--certificate-id <id>", "Custom certificate ID"),
	).action(
		async (
			domainId: string,
			options: { enabled: string; certificateType?: string; certificateId?: string },
		) => {
			if (options.enabled !== "true" && options.enabled !== "false") {
				throw usageError("--enabled expects true or false");
			}
			const https = options.enabled === "true";
			const updated = await apiPost("domain.update", {
				domainId,
				https,
				certificateType: options.certificateType ?? (https ? "letsencrypt" : "none"),
				...(options.certificateId ? { certificateId: options.certificateId } : {}),
			});
			printResult(updated, `HTTPS ${https ? "enabled" : "disabled"}.`);
		},
	);

	addOutputOptions(
		domain
			.command("validate")
			.description("Check whether a host is free across the instance")
			.argument("<host>", "FQDN to check")
			.option("--domain-id <id>", "Ignore this domain row (when renaming)"),
	).action(async (host: string, options: { domainId?: string }) => {
		const result = await apiGet("domain.validateHost", { host, domainId: options.domainId });
		printResult(result, JSON.stringify(result));
	});

	const middleware = domain
		.command("middleware")
		.description("Traefik middleware chain of one domain (replace-all semantics)");

	addOutputOptions(
		middleware
			.command("list")
			.description("List the middleware chain in order")
			.argument("<domainId>", "Domain ID"),
	).action(async (domainId: string) => {
		const rows = await apiGet<MiddlewareRow[]>("domain.middlewares", { domainId });
		printList(rows, ["domainMiddlewareId", "kind", "order", "enabled", "config"]);
	});

	addOutputOptions(
		middleware
			.command("add")
			.description("Append one middleware to the chain")
			.argument("<domainId>", "Domain ID")
			.argument("<kind>", `One of: ${MIDDLEWARE_KINDS.join(", ")}`)
			.option("--config <json>", "Middleware config as JSON", "{}")
			.option("--disabled", "Add the row but leave it disabled"),
	).action(
		async (domainId: string, kind: string, options: { config?: string; disabled?: boolean }) => {
			const existing = await apiGet<MiddlewareRow[]>("domain.middlewares", { domainId });
			const saved = await apiPost<MiddlewareRow[]>("domain.saveMiddlewares", {
				domainId,
				middlewares: [
					...toSaveShape(existing),
					{
						kind: assertMiddlewareKind(kind),
						config: parseConfig(options.config),
						enabled: options.disabled !== true,
					},
				],
			});
			printResult(saved, `Middleware ${kind} added (${saved.length} in the chain).`);
		},
	);

	addOutputOptions(
		middleware
			.command("remove")
			.description("Remove one middleware from the chain by id or kind")
			.argument("<domainId>", "Domain ID")
			.argument("<idOrKind>", "domainMiddlewareId, or a kind to drop every row of it"),
	).action(async (domainId: string, idOrKind: string) => {
		const existing = await apiGet<MiddlewareRow[]>("domain.middlewares", { domainId });
		const remaining = existing.filter(
			(row) => row.domainMiddlewareId !== idOrKind && row.kind !== idOrKind,
		);
		if (remaining.length === existing.length) {
			throw usageError(`No middleware matching "${idOrKind}" on this domain`);
		}
		const saved = await apiPost<MiddlewareRow[]>("domain.saveMiddlewares", {
			domainId,
			middlewares: toSaveShape(remaining),
		});
		printResult(saved, `Middleware removed (${saved.length} left in the chain).`);
	});

	return domain;
}
