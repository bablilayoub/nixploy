"use client";

import type { LogLineLevel } from "@nixploy/server/modules/observability/log-levels";
import { useInfiniteQuery } from "@tanstack/react-query";
import { History, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type HistoryLine = {
	t: number;
	level: LogLineLevel;
	message: string;
	container?: string | null;
	appName: string;
};

const LEVEL_CLASS: Record<LogLineLevel, string> = {
	error: "bg-destructive/15 text-destructive",
	warn: "bg-warning/15 text-warning",
	success: "bg-success/15 text-success",
	info: "bg-info/15 text-info",
	debug: "bg-muted text-muted-foreground",
	default: "",
};

const LEVEL_TAG: Record<LogLineLevel, string> = {
	error: "ERR",
	warn: "WRN",
	success: "OK",
	info: "INF",
	debug: "DBG",
	default: "",
};

const PAGE_SIZE = 200;

const formatTime = (t: number): string => {
	const date = new Date(t);
	return `${date.toLocaleDateString(undefined, { month: "short", day: "2-digit" })} ${date.toLocaleTimeString(undefined, { hour12: false })}`;
};

/**
 * Runtime log history: what the service printed, kept by the worker beyond
 * the container's lifetime. One service (`appName`) or, on the monitoring
 * page, every visible service. The first page is a query; older pages are
 * fetched on demand and appended, keyed by the server's timestamp cursor.
 */
export function RuntimeLogHistory({
	appName,
	since,
	until,
}: {
	appName?: string;
	since?: number;
	until?: number;
}) {
	const trpc = useTRPC();
	const [draft, setDraft] = useState("");
	const [query, setQuery] = useState("");
	const history = useInfiniteQuery(
		trpc.observability.runtimeLogs.infiniteQueryOptions(
			{
				appName,
				query: query || undefined,
				since,
				until,
				limit: PAGE_SIZE,
			},
			{ getNextPageParam: (page) => page.nextPageCursor },
		),
	);
	const lines: HistoryLine[] = history.data?.pages.flatMap((page) => page.lines) ?? [];
	const truncated = history.data?.pages.some((page) => page.truncated) ?? false;
	const submit = () => {
		if (draft.trim() === query) void history.refetch();
		else setQuery(draft.trim());
	};

	return (
		<div className="surface flex flex-col gap-4 overflow-hidden p-4 sm:p-5">
			<form
				className="flex flex-col gap-2 rounded-lg border bg-panel-inset p-3 sm:flex-row sm:items-center"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="relative flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder='timeout "connection refused" -healthcheck level:error container:web /re.*gex/'
						className="pl-8 font-mono text-xs"
						aria-label="Search runtime logs"
					/>
				</div>
				<Button type="submit" variant="outline" size="sm" disabled={history.isFetching}>
					{history.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
					Search
				</Button>
			</form>
			<p className="text-xs text-muted-foreground">
				Collected every 30 s from <code className="font-mono">docker logs</code> and kept past the
				container's lifetime. Terms must all match; <code className="font-mono">-term</code>{" "}
				excludes, <code className="font-mono">level:error,warn</code>,{" "}
				<code className="font-mono">container:web</code> and{" "}
				<code className="font-mono">/regex/</code> narrow further. <HelpLink slug="observability" />
			</p>

			{since !== undefined && until !== undefined && (
				<p className="text-xs text-muted-foreground">
					Incident window: {formatTime(since)} – {formatTime(until)}
				</p>
			)}
			<QueryState
				isPending={history.isPending}
				isError={history.isError}
				error={history.error}
				onRetry={() => void history.refetch()}
				isEmpty={false}
				empty={null}
			>
				{lines.length === 0 && (
					<EmptyState
						icon={History}
						title={
							history.hasNextPage
								? "No matches in this scanned range"
								: query
									? "No lines match"
									: "No history in this window"
						}
						description={
							history.hasNextPage
								? "Continue into older history to keep searching."
								: "Try a broader search. The worker collects running container output every 30 seconds."
						}
					/>
				)}

				<div className="overflow-hidden rounded-lg border border-border bg-control">
					<div className="max-h-[32rem] overflow-auto overscroll-contain font-mono text-xs">
						{lines.map((line, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only and never reordered
								key={`${line.t}-${index}`}
								className="flex items-start gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
							>
								<span className="w-40 shrink-0 tabular-nums text-muted-foreground">
									{formatTime(line.t)}
								</span>
								{line.level !== "default" ? (
									<span
										className={cn(
											"shrink-0 rounded px-1 py-px text-[10px] font-semibold",
											LEVEL_CLASS[line.level],
										)}
									>
										{LEVEL_TAG[line.level]}
									</span>
								) : (
									<span className="w-7 shrink-0" />
								)}
								{!appName ? (
									<Badge variant="outline" className="shrink-0 font-mono text-[10px]">
										{line.appName}
									</Badge>
								) : null}
								{line.container ? (
									<span className="shrink-0 text-muted-foreground">{line.container}</span>
								) : null}
								<span className="min-w-0 whitespace-pre-wrap break-all">{line.message}</span>
							</div>
						))}
					</div>
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-panel-inset px-3 py-3 text-xs text-muted-foreground">
						<span>
							{lines.length} line{lines.length === 1 ? "" : "s"}
							{truncated
								? " — the search stopped on its scan budget; narrow the query or load older"
								: ""}
						</span>
						{history.hasNextPage ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={history.isFetchingNextPage}
								onClick={() => void history.fetchNextPage()}
							>
								{history.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
								Load older
							</Button>
						) : (
							<span>End of selected history</span>
						)}
					</div>
				</div>
			</QueryState>
		</div>
	);
}
