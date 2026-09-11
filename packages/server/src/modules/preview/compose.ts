import { rm } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { domains } from "../../db/schema";
import { buildComposeFallbackDownCommand } from "../compose/commands";
import { mergeEnvVars } from "../compose/interpolate";
import { getComposeBaseDir, shellQuote } from "../compose/paths";
import { type ComposeRow, runComposeCommand } from "../compose/source";
import { parsePreviewSourceRef } from "./source-ref";

/**
 * Compose-specific half of the preview lifecycle. Everything that is shared
 * with application previews (the row, the limit, the TTL, the fork gate, the
 * PR comment) lives in `./index.ts`; this module holds the three things that
 * genuinely differ for a compose stack:
 *
 * - a preview is a whole **project**, not one service: the rendered file is
 *   deployed under the preview's own `appName`, so its compose project /
 *   stack name, its private `<appName>-net` and its per-service network
 *   aliases are all suffixed and can never collide with production;
 * - it gets **one domain per compose service that has one in production**,
 *   not a single domain;
 * - teardown is `docker compose down` / `docker stack rm` of that project,
 *   not `docker service rm`.
 */

/** Stack rows are Swarm services: their stack commands run on the primary manager. */
const runsOnPrimary = (row: Pick<ComposeRow, "composeType">): boolean =>
	row.composeType === "stack";

/** The production domain a preview domain copies its routing settings from. */
export interface ComposeExposedService {
	serviceName: string;
	port: number | null;
	https: boolean;
	certificateType: string;
	certificateId: string | null;
}

/**
 * Compose services that have a production HTTP domain, with the routing
 * settings their preview should mirror (container port, TLS). Preview rows of
 * this compose service are excluded — they carry the same `composeId` and
 * would otherwise seed a preview from a preview. `tcp`/`udp` rows are skipped:
 * they route on a named entrypoint, which a wildcard host cannot express.
 */
export async function listComposeExposedServices(
	composeId: string,
): Promise<ComposeExposedService[]> {
	const rows = await db.query.domains.findMany({
		where: and(eq(domains.composeId, composeId), isNull(domains.previewDeploymentId)),
	});
	const byService = new Map<string, ComposeExposedService>();
	for (const row of rows) {
		if (!row.serviceName || row.protocol !== "http") continue;
		if (byService.has(row.serviceName)) continue;
		byService.set(row.serviceName, {
			serviceName: row.serviceName,
			port: row.port,
			https: row.https,
			certificateType: row.https ? row.certificateType : "none",
			certificateId: row.https ? row.certificateId : null,
		});
	}
	return [...byService.values()];
}

/**
 * The row the compose render/deploy steps see for a preview job: the parent's
 * configuration under the preview's `appName`, pointed at the pull request's
 * source and carrying `previewEnv` folded into the service-level env layer.
 *
 * Mirrors `deployment/worker.ts#buildPreviewDeployTarget`. Everything
 * downstream — `prepareComposeFiles`, the deploy command, the network
 * injection — is keyed on `appName` and `env`, so nothing else has to know
 * previews exist. Isolation suffixes are dropped: the preview project name is
 * already unique, and keeping the parent's suffix would make the service
 * names (and therefore the Traefik keys) unpredictable.
 */
export function buildPreviewComposeTarget(
	row: ComposeRow,
	preview: { appName: string; branch: string | null },
): ComposeRow {
	const env = row.previewEnv ? mergeEnvVars(row.env, row.previewEnv) : row.env;
	const base: ComposeRow = {
		...row,
		appName: preview.appName,
		env,
		isolatedDeployment: false,
		suffix: "",
	};
	const source = parsePreviewSourceRef(preview.branch);
	if (!source) return base;
	if (source.kind === "fork") {
		return {
			...base,
			owner: source.owner,
			repository: source.repository,
			branch: source.branch,
			gitBranch: source.branch,
		};
	}
	const ref = source.kind === "ref" ? source.ref : source.branch;
	return { ...base, branch: ref, gitBranch: ref };
}

/**
 * Bring the preview project down and remove its working directory. Uses the
 * name-only teardown (`docker compose -p … down` / `docker stack rm`) so a
 * preview whose rendered file is missing — never deployed, clone gone — is
 * still torn down instead of blocking the delete.
 */
export async function teardownPreviewComposeProject(
	row: ComposeRow,
	previewAppName: string,
): Promise<void> {
	const target: ComposeRow = { ...row, appName: previewAppName };
	await runComposeCommand(target, buildComposeFallbackDownCommand(target), {
		onPrimary: runsOnPrimary(row),
	});
}

/** Remove the preview project's rendered file / checkout, locally and remotely. */
export async function removePreviewComposeFiles(
	row: ComposeRow,
	previewAppName: string,
): Promise<void> {
	const baseDir = getComposeBaseDir(previewAppName);
	if (row.serverId) {
		await runComposeCommand({ ...row, appName: previewAppName }, `rm -rf ${shellQuote(baseDir)}`);
	}
	// A stack pinned to a server still renders its file on the Nixploy host.
	await rm(baseDir, { recursive: true, force: true });
}
