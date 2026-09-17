"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import {
	isLiveEventsConnected,
	type LiveEvent,
	subscribeToLiveEvents,
	subscribeToLiveEventsConnection,
} from "@/lib/events-socket";
import { useTRPC } from "@/lib/trpc";

/**
 * Turn `/ws/events` frames into TanStack Query invalidations.
 *
 * This is the client half of "push instead of poll" (architecture audit #14):
 * the dashboard no longer keeps a 3 s `deployment.recent` timer (plus the
 * 15-30 s timers that each shelled out to `docker ps` server-side) alive on
 * every tab. The server pushes a transition once, this maps it onto the
 * queries that are actually stale, and React Query refetches only what is
 * mounted.
 *
 * {@link useLiveEvents} is mounted ONCE, in the dashboard shell
 * (`components/layout/authenticated-layout.tsx`). Everything else reads
 * {@link useLiveEventsConnected} to decide whether its own fallback poll is
 * needed at all.
 */

/**
 * What one frame makes stale, as data. Pure and exhaustive so the mapping can
 * be unit-tested without React, a QueryClient or a tRPC proxy.
 */
export type InvalidationTarget =
	| { path: "deployment.recent" }
	| { path: "deployment.byApplication" }
	| { path: "deployment.byCompose" }
	| { path: "deployment.byProject" }
	| { path: "deployment.statsByProject" }
	| { path: "environment.byProject" }
	| { path: "application.one"; applicationId: string }
	| { path: "application.all" }
	| { path: "compose.one"; composeId: string }
	| { path: "compose.all" }
	| { path: "compose.containers"; composeId: string }
	| { path: "docker.containers" }
	| { path: "service.one"; serviceKind: string; id: string }
	| { path: "service.all"; serviceKind: string }
	| { path: "service.getStatus"; serviceKind: string; id: string }
	| { path: "observability.serviceEvents" };

const TERMINAL_STATUSES = new Set(["done", "error", "cancelled"]);

/** The five one-click database kinds have their own routers (`postgres.one`, …). */
const DATABASE_KINDS = new Set(["postgres", "mysql", "mariadb", "mongo", "redis"]);

/**
 * Which queries a frame invalidates.
 *
 * A deployment that is still queued/running only moves the deployment lists
 * (the badge, the queue position, the log drawer's row). A terminal one also
 * moves the service's own status, the lists that render it, and the Docker
 * container view — which is exactly the polling those screens used to do.
 */
export function frameInvalidations(event: LiveEvent): InvalidationTarget[] {
	switch (event.kind) {
		case "queue":
			return [{ path: "deployment.recent" }];
		// The timeline page refetches; nothing else on screen depends on it, so
		// this frame deliberately invalidates one query and no service listings.
		case "service-event":
			return [{ path: "observability.serviceEvents" }];
		case "service-status": {
			const targets: InvalidationTarget[] = [{ path: "docker.containers" }];
			if (event.serviceKind === "application") {
				targets.push(
					{ path: "application.one", applicationId: event.id },
					{ path: "application.all" },
				);
			} else if (event.serviceKind === "compose") {
				targets.push(
					{ path: "compose.one", composeId: event.id },
					{ path: "compose.all" },
					{ path: "compose.containers", composeId: event.id },
				);
			} else if (DATABASE_KINDS.has(event.serviceKind)) {
				targets.push(
					{ path: "service.one", serviceKind: event.serviceKind, id: event.id },
					{ path: "service.all", serviceKind: event.serviceKind },
					{ path: "service.getStatus", serviceKind: event.serviceKind, id: event.id },
				);
			}
			targets.push({ path: "environment.byProject" });
			return targets;
		}
		case "deployment": {
			const targets: InvalidationTarget[] = [
				{ path: "deployment.recent" },
				{ path: "deployment.byProject" },
			];
			if (event.applicationId) targets.push({ path: "deployment.byApplication" });
			if (event.composeId) targets.push({ path: "deployment.byCompose" });
			if (!TERMINAL_STATUSES.has(event.status)) return targets;

			targets.push({ path: "deployment.statsByProject" }, { path: "environment.byProject" });
			// A preview deploy never changes the parent application's status.
			if (event.applicationId && !event.isPreview) {
				targets.push(
					{ path: "application.one", applicationId: event.applicationId },
					{ path: "application.all" },
				);
			}
			if (event.composeId) {
				targets.push(
					{ path: "compose.one", composeId: event.composeId },
					{ path: "compose.all" },
					{ path: "compose.containers", composeId: event.composeId },
				);
			}
			targets.push({ path: "docker.containers" });
			return targets;
		}
		default:
			return [];
	}
}

/** Whether the push socket is currently up — the only reason to keep a poll. */
export function useLiveEventsConnected(): boolean {
	return useSyncExternalStore(
		subscribeToLiveEventsConnection,
		isLiveEventsConnected,
		// SSR: pretend "disconnected" so the first client render keeps the
		// fallback poll until the socket actually opens.
		() => false,
	);
}

/**
 * Open the shared `/ws/events` socket and invalidate on every frame. Mount
 * exactly once, inside the authenticated dashboard shell.
 */
export function useLiveEvents(): void {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	// biome-ignore lint/correctness/useExhaustiveDependencies: trpc and queryClient are stable per provider
	useEffect(() => {
		type Namespace = Record<
			string,
			{ queryKey: (input?: unknown) => readonly unknown[]; pathKey: () => readonly unknown[] }
		>;
		const namespaceOf = (kind: string): Namespace | null =>
			(trpc as unknown as Record<string, Namespace | undefined>)[kind] ?? null;

		const keyFor = (target: InvalidationTarget): readonly unknown[] | null => {
			switch (target.path) {
				case "deployment.recent":
					return trpc.deployment.recent.pathKey();
				case "deployment.byApplication":
					return trpc.deployment.byApplication.pathKey();
				case "deployment.byCompose":
					return trpc.deployment.byCompose.pathKey();
				case "deployment.byProject":
					return trpc.deployment.byProject.pathKey();
				case "deployment.statsByProject":
					return trpc.deployment.statsByProject.pathKey();
				case "environment.byProject":
					return trpc.environment.byProject.pathKey();
				case "application.one":
					return trpc.application.one.queryKey({ applicationId: target.applicationId });
				case "application.all":
					return trpc.application.all.pathKey();
				case "compose.one":
					return trpc.compose.one.queryKey({ composeId: target.composeId });
				case "compose.all":
					return trpc.compose.all.pathKey();
				case "compose.containers":
					return trpc.compose.containers.queryKey({ composeId: target.composeId });
				case "docker.containers":
					return trpc.docker.containers.pathKey();
				case "observability.serviceEvents":
					return trpc.observability.serviceEvents.pathKey();
				case "service.one": {
					// The five database routers share one shape: `<kind>.one({ <kind>Id })`.
					const namespace = namespaceOf(target.serviceKind);
					return namespace?.one?.queryKey({ [`${target.serviceKind}Id`]: target.id }) ?? null;
				}
				case "service.all": {
					const namespace = namespaceOf(target.serviceKind);
					return namespace?.all?.pathKey() ?? null;
				}
				case "service.getStatus": {
					const namespace = namespaceOf(target.serviceKind);
					return namespace?.getStatus?.queryKey({ [`${target.serviceKind}Id`]: target.id }) ?? null;
				}
				default:
					return null;
			}
		};

		return subscribeToLiveEvents((event) => {
			const seen = new Set<string>();
			for (const target of frameInvalidations(event)) {
				const queryKey = keyFor(target);
				if (!queryKey) continue;
				const dedupe = JSON.stringify(queryKey);
				if (seen.has(dedupe)) continue;
				seen.add(dedupe);
				void queryClient.invalidateQueries({ queryKey });
			}
		});
	}, []);
}
