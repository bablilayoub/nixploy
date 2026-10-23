"use client";

import type { LogLineLevel } from "@nixploy/server/modules/observability/log-levels";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, History, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
	const [level, setLevel] = useState("all");
	const [range, setRange] = useState("all");
	const [rangeSince, setRangeSince] = useState<number | undefined>();
	const effectiveQuery = [query, level === "all" ? "" : `level:${level}`].filter(Boolean).join(" ");
	const history = useInfiniteQuery(
		trpc.observability.runtimeLogs.infiniteQueryOptions(
			{
				appName,
				query: effectiveQuery || undefined,
				since: since ?? rangeSince,
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
		<Card className="min-w-0">
			<CardContent className="flex flex-col gap-4 overflow-hidden">
				<form
					className="flex flex-col gap-2 rounded-lg border bg-muted p-3 sm:flex-row sm:items-center"
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
							placeholder="Search messages…"
							className="pl-8 font-mono text-xs"
							aria-label="Search runtime logs"
						/>
					</div>
					<Button type="submit" variant="outline" size="sm" disabled={history.isFetching}>
						{history.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
						Search
					</Button>
				</form>
				<div className="flex flex-wrap items-end gap-3">
					<div className="grid gap-2 text-xs text-muted-foreground">
						<span>Log level</span>
						<Select value={level} onValueChange={setLevel}>
							<SelectTrigger aria-label="Log level" className="w-full min-w-0">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All levels</SelectItem>
								<SelectItem value="error">Error</SelectItem>
								<SelectItem value="warn">Warning</SelectItem>
								<SelectItem value="info">Info</SelectItem>
								<SelectItem value="debug">Debug</SelectItem>
								<SelectItem value="success">Success</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{since === undefined && (
						<div className="grid gap-2 text-xs text-muted-foreground">
							<span>Time range</span>
							<Select
								value={range}
								onValueChange={(next) => {
									setRange(next);
									setRangeSince(
										next === "all" ? undefined : Date.now() - Number(next) * 60 * 60 * 1000,
									);
								}}
							>
								<SelectTrigger aria-label="Log time range" className="w-full min-w-0">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All retained logs</SelectItem>
									<SelectItem value="1">Last hour</SelectItem>
									<SelectItem value="6">Last 6 hours</SelectItem>
									<SelectItem value="24">Last 24 hours</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
					{(query || level !== "all" || range !== "all") && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setDraft("");
								setQuery("");
								setLevel("all");
								setRange("all");
								setRangeSince(undefined);
							}}
						>
							Clear filters
						</Button>
					)}
					<Collapsible className="ml-auto text-xs text-muted-foreground">
						<CollapsibleTrigger asChild>
							<Button type="button" variant="ghost" size="sm" className="group cursor-pointer py-3">
								Search syntax
								<ChevronDown
									aria-hidden="true"
									className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
								/>
							</Button>
						</CollapsibleTrigger>
						<CollapsibleContent forceMount className="data-[state=closed]:hidden">
							<p className="max-w-xl py-2 leading-relaxed">
								Terms must all match. Use <code>-term</code> to exclude, <code>container:web</code>{" "}
								for a container, <code>level:error,warn</code> for multiple levels or{" "}
								<code>/regex/</code>. <HelpLink slug="observability" />
							</p>
						</CollapsibleContent>
					</Collapsible>
				</div>
				<p className="text-xs text-muted-foreground">
					Collected every 30 seconds and retained after the container stops.
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

					<div className="overflow-hidden rounded-lg border border-border bg-background">
						<div className="max-h-[32rem] overflow-auto overscroll-contain font-mono text-xs">
							{lines.map((line, index) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only and never reordered
									key={`${line.t}-${index}`}
									className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border/60 px-3 py-3 last:border-b-0 lg:flex-nowrap"
								>
									<span className="shrink-0 tabular-nums text-muted-foreground lg:w-40">
										{formatTime(line.t)}
									</span>
									{line.level !== "default" ? (
										<span
											className={cn(
												"shrink-0 rounded px-1 py-px text-[11px] font-semibold",
												LEVEL_CLASS[line.level],
											)}
										>
											{LEVEL_TAG[line.level]}
										</span>
									) : (
										<span className="w-7 shrink-0" />
									)}
									{!appName ? (
										<Badge variant="outline" className="shrink-0 font-mono text-[11px]">
											{line.appName}
										</Badge>
									) : null}
									{line.container ? (
										<span className="min-w-0 break-all text-muted-foreground lg:max-w-40">
											{line.container}
										</span>
									) : null}
									<span className="min-w-0 w-full whitespace-pre-wrap break-words leading-relaxed lg:w-auto lg:flex-1">
										{line.message}
									</span>
								</div>
							))}
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted px-3 py-3 text-xs text-muted-foreground">
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
			</CardContent>
		</Card>
	);
}
