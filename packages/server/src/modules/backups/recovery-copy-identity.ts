import { databaseSwarmNodeId } from "../databases/placement";
import { getDocker } from "../deployment/docker";
import { preconditionFailed } from "../errors";

export type RecoveryOrigin = {
	recoveryCopyId: string;
	originServerId: string | null;
	originSwarmNodeId: string;
	originAppName: string;
	originVolumeName: string;
	originVolumeCreatedAt: string | null;
};

type Mount = { Type?: string; Source?: string; Target?: string };
export type RecoveryServiceIdentity = {
	ID: string;
	Spec?: {
		Name?: string;
		Labels?: Record<string, string>;
		Mode?: { Replicated?: { Replicas?: number } };
		TaskTemplate?: {
			Placement?: { Constraints?: string[] };
			ContainerSpec?: { Mounts?: Mount[] };
		};
		EndpointSpec?: { Ports?: unknown[] };
	};
};
export type RecoveryTaskIdentity = {
	ID?: string;
	ServiceID?: string;
	NodeID?: string;
	DesiredState?: string;
	Status?: { State?: string; ContainerStatus?: { ContainerID?: string } };
};
export type RecoveryContainerIdentity = {
	Id?: string;
	Config?: { Labels?: Record<string, string> };
	State?: { Running?: boolean };
	Mounts?: { Type?: string; Name?: string; Destination?: string; RW?: boolean }[];
};
export type RecoveryVolumeIdentity = {
	CreatedAt?: string;
	Name?: string;
	Driver?: string;
	Scope?: string;
	Labels?: Record<string, string> | null;
};

const TERMINAL = new Set(["complete", "shutdown", "failed", "rejected", "remove"]);
const ACTIVE = new Set([
	"new",
	"allocated",
	"pending",
	"assigned",
	"accepted",
	"preparing",
	"ready",
	"starting",
	"running",
]);
const UNASSIGNED = new Set(["new", "allocated", "pending"]);
const DATA_ROOT = "/var/lib/postgresql/data";
const identityError = () =>
	preconditionFailed(
		"The recovery service, task, container or volume does not match its original node. Keep tracking and inspect the original storage before continuing.",
	);

function assertVolumeIdentity(
	origin: RecoveryOrigin,
	volume: RecoveryVolumeIdentity,
): asserts volume is RecoveryVolumeIdentity & { CreatedAt: string } {
	if (
		volume.Name !== origin.originVolumeName ||
		volume.Driver !== "local" ||
		volume.Scope !== "local" ||
		volume.Labels?.["nixploy.managed"] !== "true" ||
		volume.Labels?.["nixploy.recovery.copy"] !== origin.recoveryCopyId ||
		!volume.CreatedAt ||
		!Number.isFinite(Date.parse(volume.CreatedAt)) ||
		(origin.originVolumeCreatedAt !== null && volume.CreatedAt !== origin.originVolumeCreatedAt)
	)
		throw identityError();
}

/** Pure identity checks shared by restore and deletion; labels alone are insufficient. */
export function assertRecoveryRuntimeIdentity(input: {
	origin: RecoveryOrigin;
	service: RecoveryServiceIdentity;
	tasks: RecoveryTaskIdentity[];
	containers: RecoveryContainerIdentity[];
	volume: RecoveryVolumeIdentity | null;
	restoreContainerId?: string;
}): void {
	const { origin, service, tasks, containers, volume, restoreContainerId } = input;
	const spec = service.Spec;
	const pins = spec?.TaskTemplate?.Placement?.Constraints?.filter((v) => /^node\.id\s*==/.test(v));
	const mount = spec?.TaskTemplate?.ContainerSpec?.Mounts?.filter((v) => v.Target === DATA_ROOT);
	if (
		!service.ID ||
		spec?.Name !== origin.originAppName ||
		spec.Labels?.["nixploy.managed"] !== "true" ||
		spec.Labels?.["nixploy.service.type"] !== "postgres" ||
		pins?.length !== 1 ||
		pins[0] !== `node.id==${origin.originSwarmNodeId}` ||
		mount?.length !== 1 ||
		mount[0]?.Type !== "volume" ||
		mount[0]?.Source !== origin.originVolumeName ||
		![0, 1].includes(spec.Mode?.Replicated?.Replicas ?? -1) ||
		(restoreContainerId && (spec.EndpointSpec?.Ports?.length ?? 0) > 0)
	) {
		throw identityError();
	}
	if (volume) assertVolumeIdentity(origin, volume);
	for (const task of tasks) {
		const state = task.Status?.State ?? "";
		if (
			task.ServiceID !== service.ID ||
			(!TERMINAL.has(state) && !ACTIVE.has(state)) ||
			(task.NodeID && task.NodeID !== origin.originSwarmNodeId) ||
			(!task.NodeID &&
				!TERMINAL.has(state) &&
				(!UNASSIGNED.has(state) || task.Status?.ContainerStatus?.ContainerID))
		) {
			throw identityError();
		}
	}
	for (const container of containers) {
		const labels = container.Config?.Labels;
		const task = tasks.find((v) => v.ID === labels?.["com.docker.swarm.task.id"]);
		const data = container.Mounts?.filter((v) => v.Destination === DATA_ROOT);
		if (
			!task ||
			!container.Id ||
			task.Status?.ContainerStatus?.ContainerID !== container.Id ||
			labels?.["com.docker.swarm.service.id"] !== service.ID ||
			labels?.["com.docker.swarm.service.name"] !== origin.originAppName ||
			labels?.["com.docker.swarm.node.id"] !== origin.originSwarmNodeId ||
			data?.length !== 1 ||
			data[0]?.Type !== "volume" ||
			data[0]?.Name !== origin.originVolumeName ||
			data[0]?.RW !== true ||
			!volume ||
			(container.State?.Running && task.Status?.State !== "running")
		) {
			throw identityError();
		}
	}
	if (restoreContainerId) {
		const container = containers.find((v) => v.Id === restoreContainerId);
		const running = tasks.filter((v) => v.Status?.State === "running");
		if (
			!container?.State?.Running ||
			running.length !== 1 ||
			running[0]?.DesiredState !== "running" ||
			running[0]?.Status?.ContainerStatus?.ContainerID !== restoreContainerId
		) {
			throw identityError();
		}
	}
}

function notFound(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404
	);
}

/** Reserve fresh, copy-labeled storage before any database image can touch it. */
export async function provisionRecoveryVolume(origin: RecoveryOrigin): Promise<string> {
	if ((await databaseSwarmNodeId(origin.originServerId)) !== origin.originSwarmNodeId)
		throw identityError();
	const primary = await getDocker();
	const daemon = await getDocker(origin.originServerId);
	const service = await primary
		.getService(origin.originAppName)
		.inspect()
		.catch((error: unknown) => {
			if (notFound(error)) return null;
			throw error;
		});
	const existing = await daemon
		.getVolume(origin.originVolumeName)
		.inspect()
		.catch((error: unknown) => {
			if (notFound(error)) return null;
			throw error;
		});
	const containers = await daemon.listContainers({
		all: true,
		filters: { label: [`com.docker.swarm.service.name=${origin.originAppName}`] },
	});
	if (service || existing || containers.length)
		throw preconditionFailed(
			"The fresh recovery storage name already exists; its resources were left untouched",
		);
	await daemon.createVolume({
		Name: origin.originVolumeName,
		Driver: "local",
		Labels: { "nixploy.managed": "true", "nixploy.recovery.copy": origin.recoveryCopyId },
	});
	const volume = (await daemon
		.getVolume(origin.originVolumeName)
		.inspect()) as RecoveryVolumeIdentity;
	assertVolumeIdentity(origin, volume);
	return volume.CreatedAt;
}

/** Inspect the primary's service/tasks and the recorded daemon's local storage. */
export async function inspectRecoveryRuntime(
	origin: RecoveryOrigin,
	restoreContainerId?: string,
): Promise<{
	serviceExists: boolean;
	volumeExists: boolean;
	containerId?: string;
	volumeCreatedAt?: string;
}> {
	if ((await databaseSwarmNodeId(origin.originServerId)) !== origin.originSwarmNodeId) {
		throw preconditionFailed(
			"The original recovery daemon has changed or rejoined with a different node identity. Inspect its original volume manually; tracking is retained.",
		);
	}
	const primary = await getDocker();
	const daemon = await getDocker(origin.originServerId);
	const service = (await primary
		.getService(origin.originAppName)
		.inspect()
		.catch((error: unknown) => {
			if (notFound(error)) return null;
			throw error;
		})) as RecoveryServiceIdentity | null;
	const volume = (await daemon
		.getVolume(origin.originVolumeName)
		.inspect()
		.catch((error: unknown) => {
			if (notFound(error)) return null;
			throw error;
		})) as RecoveryVolumeIdentity | null;
	if (!restoreContainerId && volume && !origin.originVolumeCreatedAt) throw identityError();
	const listed = await daemon.listContainers({
		all: true,
		filters: { label: [`com.docker.swarm.service.name=${origin.originAppName}`] },
	});
	if (!service) {
		if (restoreContainerId || listed.length > 0) throw identityError();
		if (volume) {
			if (!origin.originVolumeCreatedAt) throw identityError();
			assertVolumeIdentity(origin, volume);
		}
		return { serviceExists: false, volumeExists: volume !== null };
	}
	const tasks = (await primary.listTasks({
		filters: { service: [service.ID] },
	})) as RecoveryTaskIdentity[];
	const containers = (await Promise.all(
		listed.map((row) => daemon.getContainer(row.Id).inspect()),
	)) as RecoveryContainerIdentity[];
	const matches = restoreContainerId
		? containers.filter((v) => v.Id?.startsWith(restoreContainerId))
		: [];
	if (restoreContainerId && matches.length !== 1) throw identityError();
	const containerId = matches[0]?.Id;
	assertRecoveryRuntimeIdentity({
		origin,
		service,
		tasks,
		containers,
		volume,
		restoreContainerId: containerId,
	});
	return {
		serviceExists: true,
		volumeExists: volume !== null,
		containerId,
		volumeCreatedAt: volume?.CreatedAt,
	};
}

/** Retry a partial teardown only for the immutable volume, on its original daemon. */
export async function removeOriginalRecoveryVolume(origin: RecoveryOrigin): Promise<void> {
	if (!origin.originVolumeCreatedAt) throw identityError();
	const runtime = await inspectRecoveryRuntime(origin);
	if (runtime.serviceExists) throw identityError();
	if (!runtime.volumeExists) return;
	const daemon = await getDocker(origin.originServerId);
	const handle = daemon.getVolume(origin.originVolumeName);
	assertVolumeIdentity(origin, await handle.inspect());
	await handle.remove();
	const after = await inspectRecoveryRuntime(origin);
	if (after.serviceExists || after.volumeExists) throw identityError();
}
