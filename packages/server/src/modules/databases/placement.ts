import { getServerSwarmNodeId } from "../cluster/swarm-node";
import { getDocker } from "../deployment/docker";
import { preconditionFailed } from "../errors";

/** Local volumes belong to a concrete daemon, never to an interchangeable manager. */
export async function databaseSwarmNodeId(serverId: string | null): Promise<string> {
	const daemon = await getDocker(serverId);
	const info = await daemon.info();
	const swarm = info.Swarm;
	const nodeId = swarm?.NodeID;
	if (
		swarm?.LocalNodeState !== "active" ||
		!nodeId ||
		!/^[a-z0-9]{20,64}$/.test(nodeId) ||
		(serverId === null && swarm.ControlAvailable !== true)
	) {
		throw preconditionFailed("The database daemon is not a verified active Swarm node");
	}
	if (serverId !== null && (await getServerSwarmNodeId(serverId)) !== nodeId) {
		throw preconditionFailed("The database server no longer matches its recorded Swarm node");
	}
	const primary = await getDocker();
	const node = await primary.getNode(nodeId).inspect();
	if (node.ID !== nodeId || node.Status?.State !== "ready") {
		throw preconditionFailed("The database node is not ready in the primary Swarm");
	}
	return nodeId;
}

type PlacementTask = { NodeID?: string; Status?: { State?: string } };
const KNOWN_TASK_STATES = new Set([
	"new",
	"allocated",
	"pending",
	"assigned",
	"accepted",
	"preparing",
	"ready",
	"starting",
	"running",
	"complete",
	"shutdown",
	"failed",
	"rejected",
	"remove",
]);

/** Do not move existing local data merely because a different manager handled a request. */
export function assertDatabaseTaskNode(
	tasks: PlacementTask[],
	nodeId: string,
	constraints: string[] = [],
): void {
	if (
		constraints.some(
			(value) => /^\s*node\.id\s*==/.test(value) && value.trim() !== `node.id==${nodeId}`,
		)
	) {
		throw preconditionFailed("The existing database is pinned to another storage node");
	}

	for (const task of tasks) {
		if (task.NodeID && task.NodeID !== nodeId) {
			throw preconditionFailed(
				"Existing database tasks belong to another node. Inspect their data volume before changing placement.",
			);
		}
		if (!KNOWN_TASK_STATES.has(task.Status?.State ?? "")) {
			throw preconditionFailed("The existing database task placement cannot be verified");
		}
		if (
			!task.NodeID &&
			![
				"new",
				"allocated",
				"pending",
				"complete",
				"shutdown",
				"failed",
				"rejected",
				"remove",
			].includes(task.Status?.State ?? "")
		) {
			throw preconditionFailed("The existing database task placement cannot be verified");
		}
	}
	if (
		!constraints.includes(`node.id==${nodeId}`) &&
		!tasks.some((task) => task.NodeID === nodeId)
	) {
		throw preconditionFailed("The existing database storage node cannot be verified");
	}
}
