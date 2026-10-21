"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { QueryState } from "@/components/query-state";
import { DateTime } from "@/components/ui/date-time";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

/** A single project inventory, never an organization total or inferred backup health. */
export function DashboardRecovery({
	projects,
}: {
	projects: { projectId: string; name: string }[];
}) {
	const trpc = useTRPC();
	const labelId = useId();
	const [selected, setSelected] = useState("");
	const project = projects.find((item) => item.projectId === selected) ?? projects[0];
	const inventory = useQuery({
		...trpc.backup.copyInventory.queryOptions({ projectId: project?.projectId ?? "" }),
		enabled: !!project,
	});
	if (!project) return null;
	const copies =
		inventory.data?.items.filter((copy) => copy.status !== "deleted").slice(0, 3) ?? [];
	return (
		<section className="space-y-4 rounded-lg border bg-card p-5" aria-labelledby={labelId}>
			<h2 id={labelId} className="text-base font-semibold">
				Recovery copies
			</h2>
			<Select value={project.projectId} onValueChange={setSelected}>
				<SelectTrigger className="w-full" aria-label="Recovery copies project">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{projects.map((item) => (
						<SelectItem key={item.projectId} value={item.projectId}>
							{item.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<QueryState
				isPending={inventory.isPending}
				isError={inventory.isError}
				error={inventory.error}
				onRetry={() => inventory.refetch()}
				isEmpty={copies.length === 0}
				skeleton={<Skeleton className="h-20 w-full" />}
				empty={
					<p className="text-sm leading-relaxed text-muted-foreground">
						No retained copies on this page. Open the project inventory to inspect its recovery
						history.
					</p>
				}
			>
				<ul className="space-y-4">
					{copies.map((copy) => (
						<li key={copy.recoveryCopyId} className="space-y-1">
							<p className="text-sm font-medium wrap-anywhere">{copy.name}</p>
							<p className="text-xs leading-relaxed text-muted-foreground wrap-anywhere">
								{copy.status === "ready"
									? copy.tableCount === null
										? "Ready"
										: `${copy.tableCount} tables verified`
									: copy.status === "error"
										? "Needs attention"
										: copy.status === "interrupted"
											? "Result unavailable"
											: copy.status === "deleting"
												? "Deleting"
												: "Operation in progress"}
								{" · "}
								{copy.targetEnvironmentName}
							</p>
							<DateTime value={copy.createdAt} className="block text-xs text-muted-foreground" />
						</li>
					))}
				</ul>
			</QueryState>
			<Link
				href={`/dashboard/projects/${project.projectId}?tab=recovery-copies`}
				className="inline-flex min-h-9 items-center gap-1.5 rounded-sm text-sm font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
			>
				Open inventory
				<ArrowUpRight aria-hidden className="size-3.5" />
			</Link>
		</section>
	);
}
