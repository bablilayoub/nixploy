import { createHash } from "node:crypto";
import { getSwarmNetwork } from "../application/paths";
import { badRequest } from "../errors";
import { shellQuote } from "./paths";

/** The compose-row fields the command builders need (a full row satisfies it). */
export interface ComposeCommandRow {
	appName: string;
	composeType: "docker-compose" | "stack";
	isolatedDeployment?: boolean;
	suffix?: string | null;
}

export interface ComposeCommandFiles {
	/** Rendered compose file (`docker-compose.nixploy.yml`). */
	composeFilePath: string;
}

/** Isolation suffix in effect for the row (`""` when isolation is off). */
export function composeSuffix(row: ComposeCommandRow): string {
	return row.isolatedDeployment && row.suffix ? row.suffix : "";
}

/** Source service name with the optional isolation suffix. */
function suffixedServiceName(row: ComposeCommandRow, serviceName: string): string {
	const suffix = composeSuffix(row);
	return suffix ? `${serviceName}-${suffix}` : serviceName;
}

/**
 * Compose automatically advertises its service keys on EVERY attached network.
 * Qualify those keys so two stacks never advertise the same bare database name
 * on the environment overlay. Swarm adds its native prefix to these keys too.
 */
function qualifiedStackKey(appName: string, name: string): string | null {
	const full = `${appName}-${name}`;
	const budget = 63 - appName.length - 1;
	if (full.length <= budget) return full;
	// Docker's physical <stack>_<key> has a 63-character ceiling. Hash the
	// complete identity only on overflow; truncating names alone can collide.
	const digest = createHash("sha256")
		.update(JSON.stringify([appName, name]))
		.digest("hex");
	// Fixed 64-bit digest encoded in 13 lowercase base36 characters, plus
	// an alphabetic prefix: fits a normal generated 47-character namespace.
	const token = `n${BigInt(`0x${digest.slice(0, 16)}`)
		.toString(36)
		.padStart(13, "0")}`;
	if (budget < token.length) return null;
	const prefix = name.slice(0, Math.max(0, budget - token.length - 1));
	return prefix ? `${prefix}-${token}` : token;
}

export function deployedServiceName(row: ComposeCommandRow, serviceName: string): string {
	const name = suffixedServiceName(row, serviceName);
	if (row.composeType !== "stack") return `${row.appName}-${name}`;
	const key = qualifiedStackKey(row.appName, name);
	if (!key)
		throw badRequest(
			"Swarm stack name leaves too little space for an isolated service key; use an app name of at most 48 characters",
		);
	return key;
}

/** Old running containers and rollback snapshots keep their pre-qualification labels. */
export function deployedServiceCandidates(row: ComposeCommandRow, serviceName: string): string[] {
	return [
		...new Set([deployedServiceName(row, serviceName), suffixedServiceName(row, serviceName)]),
	];
}

/** Original source key, injected after validation and never trusted from the input. */
export const COMPOSE_SOURCE_SERVICE_LABEL = "io.nixploy.compose.source-service";

/** Legacy labels are kept verbatim; source metadata removes prefix ambiguity. */
export function sourceComposeServiceName(deployedName: string, sourceName?: string): string {
	return sourceName || deployedName;
}

/**
 * Traefik config key for one compose service — this is also the hostname the
 * service is reachable at on `nixploy-network` (exposed services) and on the
 * environment overlay (every service):
 * - docker-compose: `<appName>-<serviceName>` (network alias injected at deploy)
 * - stack: `<appName>_<serviceName>` (explicit compatibility DNS alias)
 * The isolation suffix is part of the service name in both cases.
 */
export function traefikAppName(row: ComposeCommandRow, serviceName: string | null): string {
	const name = suffixedServiceName(row, serviceName ?? "");
	return row.composeType === "stack" ? `${row.appName}_${name}` : `${row.appName}-${name}`;
}

/** DNS alias an exposed service carries on the shared overlay (both modes). */
export function sharedNetworkAlias(row: ComposeCommandRow, serviceName: string): string {
	return `${row.appName}-${suffixedServiceName(row, serviceName)}`;
}

/** Swarm service name of one compose-file service in stack mode. */
export function stackServiceName(row: ComposeCommandRow, serviceName: string): string {
	return `${row.appName}_${deployedServiceName(row, serviceName)}`;
}

/** Physical Swarm names, current qualified key first, then the legacy raw key. */
export function stackServiceCandidates(row: ComposeCommandRow, serviceName: string): string[] {
	const name = suffixedServiceName(row, serviceName);
	const key = qualifiedStackKey(row.appName, name);
	// A long legacy namespace must remain addressable even when the new key
	// cannot fit. Deployment itself refuses that unsupported transition.
	return [...new Set([...(key ? [`${row.appName}_${key}`] : []), `${row.appName}_${name}`])];
}

/**
 * Environment the docker CLI may inherit. Everything else — the panel's
 * `DATABASE_URL`, `ENCRYPTION_KEY`, provider tokens — is dropped with
 * `env -i`, so compose can never resolve a tenant's `${VAR}` or bare
 * `environment: [VAR]` from the Nixploy process. Empty values are treated
 * as unset by the docker CLI.
 */
const CLEAN_ENV_PASSTHROUGH = [
	"PATH",
	"HOME",
	"DOCKER_HOST",
	"DOCKER_CONFIG",
	"DOCKER_CONTEXT",
	"DOCKER_CERT_PATH",
	"DOCKER_TLS_VERIFY",
	"DOCKER_API_VERSION",
	"XDG_RUNTIME_DIR",
	"TMPDIR",
] as const;

export function cleanEnvPrefix(): string {
	return `env -i ${CLEAN_ENV_PASSTHROUGH.map((name) => `${name}="$${name}"`).join(" ")}`;
}

/**
 * Deploy command for a prepared row. The rendered file already carries every
 * env value (see `buildDeployComposeFile`), so neither command needs an env
 * file: `--env-file /dev/null` keeps compose from auto-loading `<dir>/.env`,
 * and `docker stack deploy` reads the file as-is (its loader has no env-file
 * support and rejects the output of `docker compose config`).
 */
export function buildComposeDeployCommand(
	row: ComposeCommandRow,
	files: ComposeCommandFiles,
): string {
	const file = shellQuote(files.composeFilePath);
	const app = shellQuote(row.appName);
	if (row.composeType === "stack") {
		return `${cleanEnvPrefix()} docker stack deploy --with-registry-auth --prune -c ${file} ${app}`;
	}
	return `${cleanEnvPrefix()} docker compose -p ${app} -f ${file} --env-file /dev/null up -d --remove-orphans`;
}

/** `docker compose stop` (keeps containers), or `docker stack rm` for stacks. */
export function buildComposeStopCommand(
	row: ComposeCommandRow,
	files: ComposeCommandFiles,
): string {
	const app = shellQuote(row.appName);
	if (row.composeType === "stack") {
		return `docker stack rm --detach=false ${app}`;
	}
	return `${cleanEnvPrefix()} docker compose -p ${app} -f ${shellQuote(files.composeFilePath)} --env-file /dev/null stop`;
}

/** Full teardown with the rendered file at hand. */
export function buildComposeDownCommand(
	row: ComposeCommandRow,
	files: ComposeCommandFiles,
): string {
	const app = shellQuote(row.appName);
	if (row.composeType === "stack") {
		return `docker stack rm --detach=false ${app}`;
	}
	return `${cleanEnvPrefix()} docker compose -p ${app} -f ${shellQuote(files.composeFilePath)} --env-file /dev/null down --remove-orphans`;
}

/**
 * Teardown when the files cannot be prepared (clone failure, file now failing
 * safety, empty compose file): both commands work from the project / stack
 * name alone.
 */
export function buildComposeFallbackDownCommand(row: ComposeCommandRow): string {
	const app = shellQuote(row.appName);
	if (row.composeType === "stack") {
		return `docker stack rm --detach=false ${app}`;
	}
	return `docker compose -p ${app} down --remove-orphans`;
}

/** Attach a running compose container to the shared overlay with its Traefik alias. */
export function sharedNetworkConnectCommand(
	row: ComposeCommandRow,
	serviceName: string,
	containerId: string,
): string {
	return `docker network connect --alias ${shellQuote(sharedNetworkAlias(row, serviceName))} ${shellQuote(getSwarmNetwork())} ${shellQuote(containerId)}`;
}

/** Attach a running swarm service to the shared overlay with its Traefik alias. */
export function sharedNetworkServiceUpdateCommand(
	row: ComposeCommandRow,
	serviceName: string,
	physicalService = stackServiceName(row, serviceName),
): string {
	const aliases = [sharedNetworkAlias(row, serviceName), traefikAppName(row, serviceName)];
	const spec = `name=${getSwarmNetwork()},${[...new Set(aliases)].map((alias) => `alias=${alias}`).join(",")}`;
	return `docker service update --network-add ${shellQuote(spec)} ${shellQuote(physicalService)}`;
}
