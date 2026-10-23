"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { type DomainLike, domainLabel, domainUrl } from "@/lib/service-url";

export interface UpstreamEntry {
	externalUpstreamId: string;
	name: string;
	description?: string | null;
	targetUrl: string;
	blockedReason?: string | null;
}

/**
 * The environment's external upstreams, under the services table. A separate
 * card on purpose: an upstream has no status, no deploy and no lifecycle
 * actions, so a row in the services table would be a row of dashes.
 */
export function UpstreamsTable({
	projectId,
	upstreams,
	primaryDomains,
	search,
}: {
	projectId: string;
	upstreams: readonly UpstreamEntry[];
	primaryDomains: ReadonlyMap<string, DomainLike>;
	search: string;
}) {
	const needle = search.trim().toLowerCase();
	const rows = upstreams.filter(
		(row) =>
			!needle ||
			[row.name, row.description, row.targetUrl].some((field) =>
				field?.toLowerCase().includes(needle),
			),
	);
	if (rows.length === 0) return null;

	return (
		<div className="mt-6 space-y-2">
			<h2 className="text-sm font-medium text-muted-foreground">External upstreams</h2>
			<TableCard>
				<Table>
					<TableBody>
						{rows.map((row) => {
							const domain = primaryDomains.get(`upstream:${row.externalUpstreamId}`);
							const url = domain ? domainUrl(domain) : null;
							return (
								<TableRow key={row.externalUpstreamId} className="group">
									<TableCell className="w-[40%]">
										<Link
											href={`/dashboard/projects/${projectId}/services/upstream/${row.externalUpstreamId}`}
											className="flex min-w-0 flex-col gap-0.5"
										>
											<span className="truncate font-medium">{row.name}</span>
											{row.description ? (
												<span className="truncate text-xs text-muted-foreground">
													{row.description}
												</span>
											) : null}
										</Link>
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{row.targetUrl}
									</TableCell>
									<TableCell>
										{row.blockedReason ? (
											<Badge variant="destructive" className="text-xs">
												Route withheld
											</Badge>
										) : url && domain ? (
											<a
												href={url}
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
											>
												{domainLabel(domain)}
												<ArrowUpRight className="size-3" />
											</a>
										) : (
											<span className="text-xs text-muted-foreground">No domain yet</span>
										)}
									</TableCell>
									<TableCell className="w-10 text-right">
										<Link
											href={`/dashboard/projects/${projectId}/services/upstream/${row.externalUpstreamId}`}
											aria-label={`Open ${row.name}`}
										>
											<ChevronRight className="size-4 text-muted-foreground" />
										</Link>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</TableCard>
		</div>
	);
}
