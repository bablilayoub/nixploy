import { createHmac, timingSafeEqual } from "node:crypto";
import type Docker from "dockerode";
import { signingKeys } from "../../lib/encryption";

export const DEPLOYMENT_HOOK_LABEL = "io.nixploy.deployment-hook";
export const DEPLOYMENT_HOOK_OWNER_LABEL = "io.nixploy.deployment-hook-owner";
const payload = (deploymentId: string, name: string, serverId: string | null) =>
	JSON.stringify([deploymentId, name, serverId]);
export function hookOwnershipToken(
	deploymentId: string,
	name: string,
	serverId: string | null,
): string {
	return createHmac("sha256", signingKeys("nixploy-deployment-hook-owner")[0] as Buffer)
		.update(payload(deploymentId, name, serverId))
		.digest("hex");
}
/** Other instances and user-managed task containers never enter this cleanup path. */
export function ownedDeploymentHook(
	container: Docker.ContainerInspectInfo,
	serverId: string | null,
): { deploymentId: string; containerId: string } | null {
	if (!/^[a-f0-9]{64}$/.test(container.Id)) return null;
	const labels = container.Config?.Labels ?? {},
		id = labels[DEPLOYMENT_HOOK_LABEL],
		token = labels[DEPLOYMENT_HOOK_OWNER_LABEL];
	if (!id || id.length > 128 || !token || !/^[a-f0-9]{64}$/.test(token)) return null;
	if (
		labels["com.docker.swarm.service.id"] ||
		labels["com.docker.compose.project"] ||
		labels["com.docker.stack.namespace"]
	)
		return null;
	if (
		container.HostConfig?.AutoRemove !== true ||
		container.Config.Entrypoint?.length !== 1 ||
		container.Config.Entrypoint[0] !== "sh"
	)
		return null;
	const name = container.Name.replace(/^\//, "");
	const valid = signingKeys("nixploy-deployment-hook-owner").some((key) => {
		const expected = createHmac("sha256", key)
			.update(payload(id, name, serverId))
			.digest();
		return timingSafeEqual(expected, Buffer.from(token, "hex"));
	});
	return valid ? { deploymentId: id, containerId: container.Id } : null;
}
