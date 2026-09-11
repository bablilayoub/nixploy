import { getSwarmNetwork } from "../application/paths";
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

/** Service name as written to the deployed file (isolation suffix applied). */
export function deployedServiceName(row: ComposeCommandRow, serviceName: string): string {
	const suffix = composeSuffix(row);
	return suffix ? `${serviceName}-${suffix}` : serviceName;
}

/**
 * Traefik config key for one compose service — this is also the hostname the
 * service is reachable at on `nixploy-network` (exposed services) and on the
 * environment overlay (every service):
 * - docker-compose: `<appName>-<serviceName>` (network alias injected at deploy)
 * - stack: `<appName>_<serviceName>` (native swarm DNS)
 * The isolation suffix is part of the service name in both cases.
 */
export function traefikAppName(row: ComposeCommandRow, serviceName: string | null): string {
	const name = deployedServiceName(row, serviceName ?? "");
	return row.composeType === "stack" ? `${row.appName}_${name}` : `${row.appName}-${name}`;
}

/** DNS alias an exposed service carries on the shared overlay (both modes). */
export function sharedNetworkAlias(row: ComposeCommandRow, serviceName: string): string {
	return `${row.appName}-${deployedServiceName(row, serviceName)}`;
}

/** Swarm service name of one compose-file service in stack mode. */
export function stackServiceName(row: ComposeCommandRow, serviceName: string): string {
	return `${row.appName}_${deployedServiceName(row, serviceName)}`;
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
		return `docker stack rm ${app}`;
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
		return `docker stack rm ${app}`;
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
		return `docker stack rm ${app}`;
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
): string {
	const spec = `name=${getSwarmNetwork()},alias=${sharedNetworkAlias(row, serviceName)}`;
	return `docker service update --network-add ${shellQuote(spec)} ${shellQuote(stackServiceName(row, serviceName))}`;
}
