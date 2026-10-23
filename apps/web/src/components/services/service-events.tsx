"use client";

import { serviceEventKindLabel } from "@nixploy/server/modules/observability/event-kinds";
import type { ServiceKind } from "@nixploy/server/modules/services/kinds";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangle,
	CircleDot,
	History,
	Loader2,
	Play,
	Rocket,
	RotateCcw,
	Settings2,
	Skull,
	Square,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * The service timeline: what happened to this service and when.
 *
 * The deployments tab answers "what did we ship"; this answers "why did it
 * restart" — task failures, out-of-memory kills, drift the reconciler had to
 * correct, and the config changes that came just before. One page per scroll,
 * keyset-paginated, refetched by the `service-event` socket frame.
 */

const PAGE_SIZE = 50;

const KIND_ICONS: Record<string, LucideIcon> = {
	deploy_started: Rocket,
	deploy_finished: Rocket,
	deploy_failed: XCircle,
	deploy_cancelled: Square,
	rollback: RotateCcw,
	task_started: Play,
	task_failed: XCircle,
	oom_killed: Skull,
	status_changed: AlertTriangle,
	config_changed: Settings2,
	scaled: CircleDot,
};

const SEVERITY_STYLES: Record<string, string> = {
	error: "border-destructive/40 bg-destructive/10 text-destructive",
	warning: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
	info: "border-border bg-muted text-muted-foreground",
};

/** Filter chips, in the order they read best: the loud ones first. */
const FILTER_GROUPS: Array<{ id: string; label: string; kinds: readonly string[] }> = [
	{ id: "all", label: "All", kinds: [] },
	{
		id: "failures",
		label: "Failures",
		kinds: ["task_failed", "oom_killed", "deploy_failed", "status_changed"],
	},
	{
		id: "deploys",
		label: "Deploys",
		kinds: ["deploy_started", "deploy_finished", "deploy_failed", "deploy_cancelled", "rollback"],
	},
	{ id: "changes", label: "Changes", kinds: ["config_changed", "scaled"] },
];

/** Metadata keys worth showing inline; the rest stays in the tooltip. */
const INLINE_METADATA = ["exitCode", "slot", "service", "from", "to", "ref"] as const;

function MetadataChips({ metadata }: { metadata: Record<string, unknown> | null }) {
	if (!metadata) return null;
	const entries = INLINE_METADATA.flatMap((key) => {
		const value = metadata[key];
		return value === undefined || value === null ? [] : [[key, String(value)] as const];
	});
	if (entries.length === 0) return null;
	return (
		<div className="mt-1 flex flex-wrap gap-1">
			{entries.map(([key, value]) => (
				<span
					key={key}
					className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
				>
					{key}: {value}
				</span>
			))}
		</div>
	);
}

interface ServiceEventItem {
	serviceEventId: string;
	kind: string;
	severity: string;
	title: string;
	message: string | null;
	occurredAt: string | Date;
	actorEmail: string | null;
	metadata: Record<string, unknown> | null;
}

function EventRow({ event }: { event: ServiceEventItem }) {
	const Icon = KIND_ICONS[event.kind] ?? CircleDot;
	const severity = SEVERITY_STYLES[event.severity] ?? SEVERITY_STYLES.info;
	return (
		<li className="flex gap-3 px-4 py-3">
			<div
				className={cn(
					"mt-0.5 flex size-7 flex-none items-center justify-center rounded-full border",
					severity,
				)}
			>
				<Icon className="size-3.5" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
					<span className="text-sm font-medium">{event.title}</span>
					<Badge variant="outline" className="text-[11px] font-normal">
						{serviceEventKindLabel(event.kind)}
					</Badge>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="text-xs text-muted-foreground">
								{formatRelative(event.occurredAt)}
							</span>
						</TooltipTrigger>
						<TooltipContent>{formatDateTime(event.occurredAt)}</TooltipContent>
					</Tooltip>
					{event.actorEmail ? (
						<span className="text-xs text-muted-foreground">by {event.actorEmail}</span>
					) : null}
				</div>
				{event.message ? (
					<p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">
						{event.message}
					</p>
				) : null}
				<MetadataChips metadata={event.metadata} />
			</div>
		</li>
	);
}

export function ServiceEvents({
	serviceType,
	serviceId,
}: {
	serviceType: ServiceKind;
	serviceId: string;
}) {
	const trpc = useTRPC();
	const [group, setGroup] = useState("all");
	const kinds = useMemo(() => {
		const found = FILTER_GROUPS.find((entry) => entry.id === group);
		return found && found.kinds.length > 0 ? [...found.kinds] : undefined;
	}, [group]);

	const query = useInfiniteQuery(
		trpc.observability.serviceEvents.infiniteQueryOptions(
			{
				serviceType,
				serviceId,
				kinds,
				limit: PAGE_SIZE,
			},
			{ getNextPageParam: (lastPage) => lastPage.nextCursor },
		),
	);

	const events = query.data?.pages.flatMap((page) => page.events) ?? [];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap gap-1">
				{FILTER_GROUPS.map((entry) => (
					<Button
						key={entry.id}
						size="sm"
						variant={group === entry.id ? "secondary" : "ghost"}
						className="h-7 px-2.5 text-xs"
						onClick={() => setGroup(entry.id)}
					>
						{entry.label}
					</Button>
				))}
			</div>

			<QueryState
				isPending={query.isPending}
				isError={query.isError}
				error={query.error}
				onRetry={() => void query.refetch()}
				skeleton={
					<div className="divide-y rounded-lg border">
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
					</div>
				}
				isEmpty={events.length === 0}
				empty={
					<EmptyState
						icon={History}
						title="No events yet"
						description={
							group === "all"
								? "Deploys, restarts, failed tasks and config changes will show up here as they happen."
								: "Nothing of this kind has happened to this service yet."
						}
					/>
				}
			>
				<ul className="divide-y rounded-lg border">
					{events.map((event) => (
						<EventRow key={event.serviceEventId} event={event} />
					))}
				</ul>
				{query.hasNextPage ? (
					<Button
						variant="outline"
						size="sm"
						className="self-center"
						disabled={query.isFetchingNextPage}
						onClick={() => void query.fetchNextPage()}
					>
						{query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
						Load older events
					</Button>
				) : null}
			</QueryState>
		</div>
	);
}
