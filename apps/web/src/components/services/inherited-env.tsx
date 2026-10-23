"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/hooks/use-capabilities";
import { parseEnvFile } from "@/lib/env-file";
import { useTRPC } from "@/lib/trpc";

const MASK = "••••••••••••";

/**
 * What this service gets without asking: the organization's shared variables,
 * then the project's, then the environment's, merged in that order. The
 * service's own editor sits above this and wins on a name collision.
 *
 * Before this the chain was invisible from the service — you could only see
 * your own variables, so an inherited `DATABASE_URL` looked like magic and an
 * accidental override looked like a bug.
 */
export function InheritedEnv({
	projectId,
	environmentId,
	environmentName,
	ownEnv,
}: {
	projectId: string;
	/** Database rows carry only the id; the name is resolved from the cache. */
	environmentId?: string | null;
	environmentName?: string | null;
	/** The service's own dotenv text — its keys are marked as overrides. */
	ownEnv: string | null;
}) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const [open, setOpen] = useState(false);
	const [revealed, setRevealed] = useState(false);

	const environmentsQuery = useQuery({
		...trpc.environment.byProject.queryOptions({ projectId }),
		enabled: !environmentName && Boolean(environmentId),
	});
	const resolvedName =
		environmentName ??
		(environmentsQuery.data ?? []).find((row) => row.environmentId === environmentId)?.name ??
		null;

	const { data } = useQuery({
		...trpc.project.getResolvedEnvironment.queryOptions({
			projectId,
			environmentName: resolvedName ?? "",
		}),
		enabled: can("secrets.read") && Boolean(resolvedName),
	});

	const entries = parseEnvFile(data?.env ?? "");
	if (entries.length === 0 || !resolvedName) return null;

	const ownKeys = new Set(parseEnvFile(ownEnv ?? "").map((entry) => entry.key));

	return (
		<div className="rounded-lg border border-border">
			<div className="flex items-center justify-between gap-2 px-3 py-2">
				<button
					type="button"
					className="flex min-w-0 items-center gap-2 text-sm"
					onClick={() => setOpen((value) => !value)}
					aria-expanded={open}
				>
					{open ? (
						<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
					)}
					<Layers className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate font-medium">
						{entries.length} inherited {entries.length === 1 ? "variable" : "variables"}
					</span>
				</button>
				{open && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setRevealed((value) => !value)}
					>
						{revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
						{revealed ? "Hide all" : "Reveal all"}
					</Button>
				)}
			</div>
			{open && (
				<>
					<p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
						From the organization, the project and the{" "}
						<span className="font-mono">{resolvedName}</span> environment. A variable you set above
						with the same name wins.{" "}
						<Link
							href={`/dashboard/projects/${projectId}?tab=environment`}
							className="underline underline-offset-2"
						>
							Edit the chain
						</Link>
					</p>
					<ul className="max-h-64 divide-y divide-border overflow-auto border-t border-border">
						{entries.map((entry) => {
							const overridden = ownKeys.has(entry.key);
							return (
								<li
									key={entry.key}
									className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs"
								>
									<span className="w-2/5 shrink-0 truncate" title={entry.key}>
										{entry.key}
									</span>
									<span className="min-w-0 flex-1 truncate text-muted-foreground">
										{revealed ? entry.value || <span className="italic">(empty)</span> : MASK}
									</span>
									{overridden && (
										<span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
											overridden here
										</span>
									)}
								</li>
							);
						})}
					</ul>
				</>
			)}
		</div>
	);
}
