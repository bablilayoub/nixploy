/**
 * Pure helpers for pinning Swarm tasks to a managed server's node. Kept free
 * of db/ssh imports so spec builders (deployment/swarm.ts, databases/engine.ts,
 * compose/compose-file.ts) and their unit tests can use them directly; the
 * node-id lookup itself lives in `swarm-node.ts`.
 *
 * Why a constraint at all: managed servers join the PRIMARY swarm (usually as
 * workers), so every Swarm *service* object is created on the primary
 * manager. Without a placement constraint the scheduler may put the task on
 * any node — and the locally built `<app>:latest` image and the `<app>-data`
 * volume only exist on the server the service is pinned to.
 */

/** Placement constraint pinning a task to one swarm node. */
export const nodeIdConstraint = (swarmNodeId: string): string => `node.id==${swarmNodeId}`;

/** Whether a constraint pins a task to a node by id (`node.id==…`). */
export const isNodeIdConstraint = (constraint: string): boolean =>
	/^\s*node\.id\s*==/.test(constraint);

/**
 * Merge the pinned server's `node.id==` constraint into a user-supplied
 * constraint list. The user's other constraints (labels, roles, `!=`) are
 * kept in order, duplicates are dropped, and any other `node.id==` pin is
 * replaced — a stale or foreign pin next to ours would make the task
 * unschedulable. Without a `swarmNodeId` the list is returned normalized.
 */
export function mergeNodeConstraint(
	constraints: readonly unknown[] | null | undefined,
	swarmNodeId: string | null | undefined,
): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (value: string) => {
		if (!seen.has(value)) {
			seen.add(value);
			out.push(value);
		}
	};
	for (const entry of constraints ?? []) {
		if (typeof entry !== "string") continue;
		const constraint = entry.trim();
		if (!constraint) continue;
		if (swarmNodeId && isNodeIdConstraint(constraint)) continue;
		push(constraint);
	}
	if (swarmNodeId) push(nodeIdConstraint(swarmNodeId));
	return out;
}

export interface SwarmNodeSummary {
	id: string;
	hostname: string;
	addr: string;
}

/**
 * Fallback lookup when the server cannot report its own node id over SSH:
 * match the primary's `docker node ls` by the address the node advertised
 * or by hostname (servers are often registered by DNS name).
 */
export function matchSwarmNode(
	nodes: readonly SwarmNodeSummary[],
	ipAddress: string,
): string | null {
	const wanted = ipAddress.trim().toLowerCase();
	if (!wanted) return null;
	const byAddr = nodes.find((node) => node.addr.trim().toLowerCase() === wanted);
	if (byAddr) return byAddr.id;
	const byHost = nodes.find((node) => node.hostname.trim().toLowerCase() === wanted);
	return byHost?.id ?? null;
}
