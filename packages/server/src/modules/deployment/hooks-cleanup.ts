import type Docker from "dockerode";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deployments } from "../../db/schema";
import { bestEffort } from "../../utils/best-effort";
import { getDocker } from "./docker";
import { DEPLOYMENT_HOOK_LABEL, ownedDeploymentHook } from "./hook-ownership";

/** Recover a create that completed after cancellation/transport loss or worker exit. */
export async function pruneDeploymentHookContainers(): Promise<number> {
	const servers = await db.query.servers.findMany({ columns: { serverId: true } });
	let removed = 0;
	for (const serverId of [null, ...servers.map((server) => server.serverId)]) {
		await bestEffort("Recover owned deployment-hook containers", async () => {
			const docker = await getDocker(serverId);
			const candidates = await docker.listContainers({
				all: true,
				filters: { label: [DEPLOYMENT_HOOK_LABEL] },
			});
			for (const candidate of candidates) {
				if (!/^[a-f0-9]{64}$/.test(candidate.Id)) continue;
				await bestEffort("Remove terminal deployment-hook container", async () => {
					const container = docker.getContainer(candidate.Id);
					let inspected: Docker.ContainerInspectInfo;
					try {
						inspected = await container.inspect();
					} catch (error) {
						if ((error as { statusCode?: number })?.statusCode === 404) return;
						throw error;
					}
					if (inspected.Id !== candidate.Id) return;
					const owner = ownedDeploymentHook(inspected, serverId);
					if (!owner) return;
					const row = await db.query.deployments.findFirst({
						where: eq(deployments.deploymentId, owner.deploymentId),
						columns: { status: true },
					});
					if (row?.status === "queued" || row?.status === "running") return;
					try {
						await container.remove({ force: true, v: true });
						removed++;
					} catch (error) {
						if ((error as { statusCode?: number })?.statusCode !== 404) throw error;
					}
				});
			}
		});
	}
	return removed;
}
