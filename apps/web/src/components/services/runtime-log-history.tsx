"use client";

import type { LogLineLevel } from "@nixploy/server/modules/observability/log-levels";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { toastError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";
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
export function RuntimeLogHistory({ appName }: { appName?: string }) {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const [draft, setDraft] = useState("");
	const [query, setQuery] = useState("");
	const [older, setOlder] = useState<{ lines: HistoryLine[]; cursor: number | null } | null>(null);
	const [loadingOlder, setLoadingOlder] = useState(false);

	const input = { appName, query: query || undefined, limit: PAGE_SIZE };
	const firstPage = useQuery(trpc.observability.runtimeLogs.queryOptions(input));

	const lines: HistoryLine[] = [...(firstPage.data?.lines ?? []), ...(older?.lines ?? [])];
	const cursor = older ? older.cursor : (firstPage.data?.nextCursor ?? null);
	const truncated = firstPage.data?.truncated ?? false;

	const submit = () => {
		setOlder(null);
		setQuery(draft.trim());
	};

	const loadOlder = async () => {
		if (cursor === null) return;
		setLoadingOlder(true);
		try {
			const page = await trpcClient.observability.runtimeLogs.query({ ...input, before: cursor });
			setOlder((current) => ({
				lines: [...(current?.lines ?? []), ...page.lines],
				cursor: page.nextCursor,
			}));
		} catch (error) {
			toastError(error, "Failed to load older lines");
		} finally {
			setLoadingOlder(false);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<form
				className="flex flex-col gap-2 sm:flex-row sm:items-center"
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
				<Button type="submit" variant="outline" size="sm" disabled={firstPage.isFetching}>
					{firstPage.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
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

			<QueryState
				isPending={firstPage.isPending}
				isError={firstPage.isError}
				error={firstPage.error}
				onRetry={() => firstPage.refetch()}
				isEmpty={lines.length === 0}
				empty={
					<EmptyState
						icon={History}
						title={query ? "No lines match" : "No history yet"}
						description={
							query
								? "Try fewer terms, or load older history from a wider window."
								: "The worker collects output every 30 s while a container runs; the first lines show up within a minute."
						}
					/>
				}
			>
				<div className="overflow-hidden rounded-lg border border-border">
					<div className="max-h-[32rem] overflow-auto font-mono text-xs">
						{lines.map((line, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: lines are append-only and never reordered
								key={`${line.t}-${index}`}
								className="flex items-start gap-2 border-b border-border/60 px-3 py-1 last:border-b-0"
							>
								<span className="shrink-0 tabular-nums text-muted-foreground">
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
					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
						<span>
							{lines.length} line{lines.length === 1 ? "" : "s"}
							{truncated
								? " — the search stopped on its scan budget; narrow the query or load older"
								: ""}
						</span>
						{cursor !== null ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={loadingOlder}
								onClick={() => void loadOlder()}
							>
								{loadingOlder ? <Loader2 className="size-4 animate-spin" /> : null}
								Load older
							</Button>
						) : (
							<span>Start of history</span>
						)}
					</div>
				</div>
			</QueryState>
		</div>
	);
}
