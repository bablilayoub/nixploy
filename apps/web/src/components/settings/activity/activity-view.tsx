"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, Loader2, Search } from "lucide-react";
import { useState } from "react";

import { QueryState } from "@/components/query-state";
import { PageHeader } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

const PAGE_SIZE = 50;
const ALL = "__all__";

const ACTION_VARIANTS: Record<
	string,
	"success" | "info" | "destructive" | "warning" | "secondary"
> = {
	create: "success",
	deploy: "info",
	delete: "destructive",
	remove: "destructive",
	prune: "warning",
};

function ActionBadge({ action }: { action: string }) {
	const verb = action.split(".").pop() ?? action;
	const variant = ACTION_VARIANTS[verb] ?? "secondary";
	return (
		<Badge variant={variant} className="font-mono text-[11px]">
			{action}
		</Badge>
	);
}

function formatTime(value: Date | string): string {
	const date = typeof value === "string" ? new Date(value) : value;
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/**
 * Audit log. Rendered as the Monitoring page's "Audit log" tab (UX audit
 * F11); `embedded` drops the page title that tab already carries.
 */
export function ActivityView({ embedded = false }: { embedded?: boolean } = {}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [action, setAction] = useState(ALL);
	const [targetType, setTargetType] = useState(ALL);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const [exporting, setExporting] = useState(false);

	// Query on pauses in typing, not on every keystroke.
	const debouncedSearch = useDebouncedValue(search.trim(), 300);

	const facetsQuery = useQuery(trpc.audit.facets.queryOptions());
	const auditQuery = useQuery({
		...trpc.audit.all.queryOptions({
			action: action === ALL ? undefined : action,
			targetType: targetType === ALL ? undefined : targetType,
			search: debouncedSearch || undefined,
			limit: PAGE_SIZE,
			offset: page * PAGE_SIZE,
		}),
		// Keep the current rows on screen while the next filter/page loads
		// instead of collapsing the table to a skeleton.
		placeholderData: keepPreviousData,
	});

	const rows = auditQuery.data?.rows ?? [];
	const total = auditQuery.data?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

	const resetFilters = () => {
		setAction(ALL);
		setTargetType(ALL);
		setSearch("");
		setPage(0);
	};

	/**
	 * `audit.export` renders the whole filtered trail (every column, including
	 * ip/user agent/metadata) as CSV server-side; the browser only has to turn
	 * the string into a file. Not a `useQuery`: an export is an action, and its
	 * result must never be cached or refetched in the background.
	 */
	const exportCsv = async () => {
		setExporting(true);
		try {
			const result = await queryClient.fetchQuery(
				trpc.audit.export.queryOptions({
					action: action === ALL ? undefined : action,
					targetType: targetType === ALL ? undefined : targetType,
					search: debouncedSearch || undefined,
				}),
			);
			const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
			const link = document.createElement("a");
			link.href = url;
			link.download = result.filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			// Revoking immediately can race the download in Safari; a tick is enough.
			setTimeout(() => URL.revokeObjectURL(url), 1_000);
		} catch (error) {
			toastError(error, "Export failed");
		} finally {
			setExporting(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			{embedded ? null : (
				<PageHeader
					title="Audit log"
					description="Audit trail of everything that happens in this organization."
				/>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search targets…"
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
							setPage(0);
						}}
						className="w-56 pl-8"
					/>
				</div>
				<Select
					value={action}
					onValueChange={(value) => {
						setAction(value);
						setPage(0);
					}}
				>
					<SelectTrigger className="w-48">
						<SelectValue placeholder="All actions" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All actions</SelectItem>
						{(facetsQuery.data?.actions ?? []).map((item) => (
							<SelectItem key={item} value={item}>
								{item}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select
					value={targetType}
					onValueChange={(value) => {
						setTargetType(value);
						setPage(0);
					}}
				>
					<SelectTrigger className="w-40">
						<SelectValue placeholder="All types" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All types</SelectItem>
						{(facetsQuery.data?.targetTypes ?? []).map((item) => (
							<SelectItem key={item} value={item}>
								{item}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					variant="outline"
					size="sm"
					className="ml-auto"
					disabled={exporting || rows.length === 0}
					onClick={exportCsv}
				>
					{exporting ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Download className="size-3.5" />
					)}
					Export CSV
				</Button>
			</div>

			<QueryState
				isPending={auditQuery.isPending}
				isError={auditQuery.isError}
				error={auditQuery.error}
				onRetry={() => auditQuery.refetch()}
				skeleton={<Skeleton className="h-64 w-full" />}
				isEmpty={rows.length === 0}
				empty={
					<div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
						<History className="size-6 text-muted-foreground" />
						<p className="text-sm font-medium">No audit events yet</p>
						<p className="text-xs text-muted-foreground">
							{action !== ALL || targetType !== ALL || search ? (
								<>
									Nothing matches these filters.{" "}
									<button type="button" className="underline" onClick={resetFilters}>
										Reset filters
									</button>
								</>
							) : (
								"Actions like deploys, deletions and member changes appear here."
							)}
						</p>
					</div>
				}
			>
				<TableCard className={auditQuery.isPlaceholderData ? "opacity-60" : undefined}>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-28">Time</TableHead>
								<TableHead>Actor</TableHead>
								<TableHead>Action</TableHead>
								<TableHead>Target</TableHead>
								<TableHead className="w-32">IP</TableHead>
								<TableHead>Details</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.auditId}>
									<TableCell className="whitespace-nowrap text-xs text-muted-foreground">
										{formatTime(row.createdAt)}
									</TableCell>
									<TableCell className="text-xs">
										{row.actorEmail ?? (row.actorId ? row.actorId.slice(0, 8) : "system")}
									</TableCell>
									<TableCell>
										<ActionBadge action={row.action} />
									</TableCell>
									<TableCell className="max-w-56 truncate text-xs">
										{row.targetName ?? row.targetId ?? "—"}
										{row.targetType && (
											<span className="ml-1.5 text-muted-foreground">({row.targetType})</span>
										)}
									</TableCell>
									<TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
										{row.ip ? (
											row.userAgent ? (
												<Tooltip>
													<TooltipTrigger asChild>
														<span className="cursor-help underline decoration-dotted underline-offset-4">
															{row.ip}
														</span>
													</TooltipTrigger>
													<TooltipContent className="font-mono">{row.userAgent}</TooltipContent>
												</Tooltip>
											) : (
												row.ip
											)
										) : (
											"—"
										)}
									</TableCell>
									<TableCell className="max-w-64 truncate font-mono text-[11px] text-muted-foreground">
										{row.metadata ?? "—"}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableCard>
			</QueryState>

			{pageCount > 1 && (
				<div className="flex items-center justify-between text-sm text-muted-foreground">
					<span>
						Page {page + 1} of {pageCount} · {total} entries
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page === 0}
							onClick={() => setPage((value) => value - 1)}
						>
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= pageCount - 1}
							onClick={() => setPage((value) => value + 1)}
						>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
