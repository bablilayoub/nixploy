"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

import { confirmDiscardUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

export type RecentDeployment =
	inferRouterOutputs<AppRouter>["deployment"]["recent"]["deployments"][number];

export type RunningDeploymentScope = {
	applicationId?: string;
	composeId?: string;
	projectId?: string;
};

/** Newest org-wide rows the shared query watches; in-flight jobs are always at the top. */
const RECENT_LIMIT = 25;
/** Poll cadence while at least one deployment is queued or running. */
const POLL_MS = 3_000;

export const isActiveDeployment = (status: string): boolean =>
	status === "running" || status === "queued";

/** Trigger enum → chip label (`deployment.trigger`). */
export const TRIGGER_LABELS: Record<string, string> = {
	manual: "Manual",
	api: "API",
	webhook: "Webhook",
	schedule: "Schedule",
	preview: "Preview",
	rollback: "Rollback",
	redeploy: "Redeploy",
	gitops: "GitOps",
	system: "System",
};

const PROVIDER_LABELS: Record<string, string> = {
	github: "GitHub",
	gitlab: "GitLab",
	bitbucket: "Bitbucket",
	gitea: "Gitea",
};

/** "by Jane" / "via GitHub webhook" / "scheduled run" — null when nothing useful is known. */
export function describeTriggeredBy(row: {
	triggeredBy?: string | null;
	triggeredByName?: string | null;
}): string | null {
	if (row.triggeredByName) return `by ${row.triggeredByName}`;
	const raw = row.triggeredBy ?? "";
	if (raw.startsWith("webhook:")) {
		const provider = raw.slice("webhook:".length);
		return `via ${PROVIDER_LABELS[provider] ?? provider} webhook`;
	}
	if (raw.startsWith("schedule:")) return "scheduled run";
	return null;
}

/** First non-empty line of a multi-line message / error. */
export function firstLine(text: string | null | undefined): string | null {
	if (!text) return null;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

/**
 * In-flight deployments the page already knows about, keyed by id. Module
 * level on purpose: every mounted instance of the hook sees the same query
 * data, so the first one to observe a queued/running → terminal edge handles
 * the invalidation and the others find nothing left to do.
 */
const inFlight = new Map<string, RecentDeployment>();

/**
 * One shared view of what is deploying right now (UX audit F13): the header
 * status, the top-nav hairline, the project services table and the compose
 * header all read `deployment.recent` through this hook. The query polls
 * only while something is queued or running; every deploy mutation
 * invalidates it, which is what starts the polling. When a deployment
 * settles, the service status queries (`application.one` / `compose.one`,
 * the `all` lists, environment counts) and the deployment lists are
 * invalidated once, so status badges catch up without their own timers.
 */
export function useRunningDeployments(scope: RunningDeploymentScope = {}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const query = useQuery({
		...trpc.deployment.recent.queryOptions({ limit: RECENT_LIMIT }),
		refetchInterval: (state) =>
			(state.state.data?.deployments ?? []).some((deployment) =>
				isActiveDeployment(deployment.status),
			)
				? POLL_MS
				: false,
	});
	const data = query.data;

	// biome-ignore lint/correctness/useExhaustiveDependencies: only the data edge matters; trpc/queryClient are stable per provider
	useEffect(() => {
		if (!data) return;
		const rows = data.deployments;
		const activeNow = new Set<string>();
		for (const row of rows) {
			if (isActiveDeployment(row.status)) {
				activeNow.add(row.deploymentId);
				inFlight.set(row.deploymentId, row);
			}
		}
		const settled = [...inFlight.entries()].filter(([id]) => !activeNow.has(id));
		if (settled.length === 0) return;
		for (const [id] of settled) inFlight.delete(id);

		const invalidate = (queryKey: readonly unknown[]) =>
			queryClient.invalidateQueries({ queryKey });
		let anyApplication = false;
		let anyCompose = false;
		for (const [, row] of settled) {
			if (row.applicationId) {
				anyApplication = true;
				invalidate(trpc.application.one.queryKey({ applicationId: row.applicationId }));
			}
			if (row.composeId) {
				anyCompose = true;
				invalidate(trpc.compose.one.queryKey({ composeId: row.composeId }));
			}
		}
		if (anyApplication) {
			invalidate(trpc.application.all.pathKey());
			invalidate(trpc.deployment.byApplication.pathKey());
		}
		if (anyCompose) {
			invalidate(trpc.compose.all.pathKey());
			invalidate(trpc.deployment.byCompose.pathKey());
		}
		invalidate(trpc.environment.byProject.pathKey());
		invalidate(trpc.deployment.byProject.pathKey());
		invalidate(trpc.deployment.statsByProject.pathKey());
	}, [data]);

	const deployments = useMemo(() => {
		const rows = data?.deployments ?? [];
		return rows.filter(
			(row) =>
				(!scope.applicationId || row.applicationId === scope.applicationId) &&
				(!scope.composeId || row.composeId === scope.composeId) &&
				(!scope.projectId || row.project.projectId === scope.projectId),
		);
	}, [data, scope.applicationId, scope.composeId, scope.projectId]);

	const active = useMemo(
		() => deployments.filter((row) => isActiveDeployment(row.status)),
		[deployments],
	);

	return {
		/** Recent deployments inside `scope` (newest first). */
		deployments,
		/** Queued/running deployments inside `scope`. */
		active,
		/** Anything in flight anywhere in the organization. */
		anyActive: (data?.deployments ?? []).some((row) => isActiveDeployment(row.status)),
		isLoading: query.isLoading,
		isPending: query.isPending,
		isError: query.isError,
		error: query.error,
		refetch: query.refetch,
	};
}

/**
 * "Follow the deploy" (UX audit F2): after a deploy is queued, jump to the
 * Deployments tab with `?deployment=<id>` so `DeploymentHistory` opens that
 * row's log drawer. Uses the same `?tab=` param `useSyncedTab` reads, and
 * respects the unsaved-changes guard the tab switch would have shown.
 */
export function useFollowDeployment() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	return useCallback(
		(deploymentId: string) => {
			const params = new URLSearchParams(searchParams.toString());
			const alreadyThere = params.get("tab") === "deployments";
			if (!alreadyThere && !confirmDiscardUnsavedChanges()) return;
			params.set("tab", "deployments");
			params.set("deployment", deploymentId);
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[pathname, router, searchParams],
	);
}
