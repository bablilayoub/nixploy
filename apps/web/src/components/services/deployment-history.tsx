"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Bot, ChevronDown, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { capabilityHint } from "@/components/services/capability-hint";
import { LogViewer } from "@/components/services/log-viewer";
import { DeploymentStatusBadge } from "@/components/services/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useLiveEventsConnected } from "@/hooks/use-live-events";
import { describeTriggeredBy, firstLine, TRIGGER_LABELS } from "@/hooks/use-running-deployments";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { toastError } from "@/lib/describe-error";
import { formatDuration } from "@/lib/format";
import { deploymentStatusLabel } from "@/lib/status";
import { useTRPC } from "@/lib/trpc";

const PAGE_SIZE = 10;

// Provider commit URLs are derived from the service row + sha at render
// time (no `commit_url` column), by the import-free server helper shared
// with the preview flow; re-exported so existing callers keep their import.
export { buildCommitUrl, type CommitLinkSource } from "@nixploy/server/modules/git/commit-url";

/** Short display form: 7 chars for a git sha, `sha256:abcdef1` for an image digest. */
const shortSha = (sha: string): string =>
	sha.startsWith("sha256:") ? `sha256:${sha.slice(7, 14)}` : sha.slice(0, 7);

type ExplainResult = {
	summary: string;
	rootCause: string;
	steps: string[];
	suggestedPatch: string | null;
	model: string;
	deploymentId: string;
};

type DeploymentRow = {
	deploymentId: string;
	title: string;
	status: "queued" | "running" | "done" | "error" | "cancelled";
	/** Place in the server's deploy line while `queued`; null otherwise. */
	queuePosition?: number | null;
	errorMessage: string | null;
	createdAt: Date | string;
	startedAt: Date | string | null;
	finishedAt: Date | string | null;
	/** Provenance (migration 0020); older rows carry nulls. */
	trigger?: string | null;
	triggeredBy?: string | null;
	triggeredByName?: string | null;
	commitSha?: string | null;
	commitMessage?: string | null;
	commitAuthor?: string | null;
};

/** Queued and running deployments are both "in flight" for polling and cancel. */
const isActive = (status: DeploymentRow["status"]) => status === "running" || status === "queued";

export type DeploymentHistoryProps = {
	kind: "application" | "compose";
	serviceId: string;
	description: string;
	/** Application deployments can be cancelled while running. */
	canCancel?: boolean;
	/** Provider commit page for a sha; omit (or return null) to render the sha as text. */
	commitUrl?: (sha: string) => string | null;
	/**
	 * Open this deployment's log drawer as soon as its row is listed. The
	 * `?deployment=<id>` query param (set by "follow the deploy") does the
	 * same without a prop.
	 */
	initialOpenDeploymentId?: string | null;
};

/**
 * Shared deployments list + log drawer + Deploy Copilot dialog for application
 * and compose services. Preview deployments stay in the application caller.
 */
export function DeploymentHistory({
	kind,
	serviceId,
	description,
	canCancel = false,
	commitUrl,
	initialOpenDeploymentId,
}: DeploymentHistoryProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const live = useLiveEventsConnected();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { can } = useCapabilities();
	const [logDeployment, setLogDeployment] = useState<DeploymentRow | null>(null);
	const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
	const requestedDeploymentId = initialOpenDeploymentId ?? searchParams.get("deployment");
	// Opened once per requested id; a closed drawer must not pop back open on refetch.
	const openedRef = useRef<string | null>(null);

	const closeLogs = () => {
		setLogDeployment(null);
		if (searchParams.get("deployment")) {
			const params = new URLSearchParams(searchParams.toString());
			params.delete("deployment");
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
		}
	};

	const listPathKey =
		kind === "application"
			? trpc.deployment.byApplication.pathKey()
			: trpc.deployment.byCompose.pathKey();

	const invalidateList = () => {
		queryClient.invalidateQueries({ queryKey: listPathKey });
	};

	/**
	 * The service header and the project services table read `status` from
	 * `<kind>.one` / `<kind>.all`, which nothing refreshes once a deployment
	 * settles — refresh them whenever the list observes a running → terminal
	 * transition or the log stream sends its `finish` frame.
	 */
	const invalidateServiceStatus = () => {
		if (kind === "application") {
			queryClient.invalidateQueries({
				queryKey: trpc.application.one.queryKey({ applicationId: serviceId }),
			});
			queryClient.invalidateQueries({ queryKey: trpc.application.all.pathKey() });
		} else {
			queryClient.invalidateQueries({
				queryKey: trpc.compose.one.queryKey({ composeId: serviceId }),
			});
			queryClient.invalidateQueries({ queryKey: trpc.compose.all.pathKey() });
		}
	};

	const applicationQuery = useInfiniteQuery({
		...trpc.deployment.byApplication.infiniteQueryOptions(
			{ applicationId: serviceId, limit: PAGE_SIZE },
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor,
				// Fallback only: with `/ws/events` up, every transition of these
				// rows arrives as a push and invalidates the list.
				refetchInterval: (query) => {
					if (live) return false;
					const pages = query.state.data?.pages ?? [];
					const hasActive = pages.some((page) =>
						page.deployments.some((deployment) => isActive(deployment.status)),
					);
					return hasActive ? 2_000 : false;
				},
			},
		),
		enabled: kind === "application",
	});

	const composeQuery = useInfiniteQuery({
		...trpc.deployment.byCompose.infiniteQueryOptions(
			{ composeId: serviceId, limit: PAGE_SIZE },
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor,
				// Fallback only: with `/ws/events` up, every transition of these
				// rows arrives as a push and invalidates the list.
				refetchInterval: (query) => {
					if (live) return false;
					const pages = query.state.data?.pages ?? [];
					const hasActive = pages.some((page) =>
						page.deployments.some((deployment) => isActive(deployment.status)),
					);
					return hasActive ? 2_000 : false;
				},
			},
		),
		enabled: kind === "compose",
	});

	const deploymentsQuery = kind === "application" ? applicationQuery : composeQuery;

	const cancel = useSaveMutation(trpc.application.cancelDeployment.mutationOptions(), {
		successMessage: "Deployment cancelled",
		invalidate: [listPathKey],
	});

	const explain = useSaveMutation(
		trpc.ai.explainDeployment.mutationOptions({
			onSuccess: (result) => setExplainResult(result),
		}),
	);

	const redeployHandlers = { onSuccess: () => setExplainResult(null) };
	const redeployConfig = { successMessage: "Redeploy queued", invalidate: [listPathKey] };

	const redeployApplication = useSaveMutation(
		trpc.application.redeploy.mutationOptions(redeployHandlers),
		redeployConfig,
	);
	const redeployCompose = useSaveMutation(
		trpc.compose.redeploy.mutationOptions(redeployHandlers),
		redeployConfig,
	);
	const redeployPending =
		kind === "application" ? redeployApplication.isPending : redeployCompose.isPending;

	const applyPatch = useMutation(
		trpc.ai.applySuggestedPatch.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					result.deploymentId
						? `Applied ${result.appliedKeys.join(", ")} and queued redeploy`
						: `Applied ${result.appliedKeys.join(", ")}`,
				);
				setExplainResult(null);
				invalidateList();
				if (kind === "application") {
					queryClient.invalidateQueries({
						queryKey: trpc.application.one.queryKey({ applicationId: serviceId }),
					});
				}
			},
			onError: (error) => toastError(error),
		}),
	);

	const deployments =
		(deploymentsQuery.data?.pages.flatMap((page) => page.deployments) as DeploymentRow[]) ?? [];
	// The log drawer holds the row it was opened with; re-reading it from the
	// list keeps its title status honest when the deployment settles while the
	// drawer is open (it used to say "Running" under a finished log).
	const openLogDeployment = logDeployment
		? (deployments.find((row) => row.deploymentId === logDeployment.deploymentId) ?? logDeployment)
		: null;
	const latestError = deployments.find((deployment) => deployment.status === "error");
	const hasActive = deployments.some((deployment) => isActive(deployment.status));

	// In flight → settled: the list polls every 2s while a deployment is
	// queued or running, so this edge fires within seconds of the worker finishing.
	const hadActiveRef = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only the in-flight edge matters; the invalidation helper reads stable ids
	useEffect(() => {
		if (hadActiveRef.current && !hasActive) {
			invalidateServiceStatus();
		}
		hadActiveRef.current = hasActive;
	}, [hasActive]);

	// "Follow the deploy": open the requested row's logs as soon as it shows
	// up in the list (the row is inserted a moment before the mutation
	// returns, so the first refetch usually carries it).
	useEffect(() => {
		if (!requestedDeploymentId || openedRef.current === requestedDeploymentId) return;
		const row = deployments.find((deployment) => deployment.deploymentId === requestedDeploymentId);
		if (!row) return;
		openedRef.current = requestedDeploymentId;
		setLogDeployment(row);
	}, [requestedDeploymentId, deployments]);

	const canDeploy = can("service.deploy");
	const canExplain = can("ai.use");
	const canApplyPatch = can("ai.use") && can("secrets.write") && can("service.deploy");

	const cachedExplanation = useQuery({
		...trpc.ai.getExplanation.queryOptions({
			deploymentId: latestError?.deploymentId ?? "",
		}),
		enabled: Boolean(latestError?.deploymentId),
		refetchInterval: (query) => {
			if (query.state.data) return false;
			const finishedAt = latestError?.finishedAt ? new Date(latestError.finishedAt).getTime() : 0;
			if (finishedAt && Date.now() - finishedAt > 120_000) return false;
			return 3_000;
		},
	});

	const onRedeploy = () => {
		if (kind === "application") {
			redeployApplication.mutate({ applicationId: serviceId });
		} else {
			redeployCompose.mutate({ composeId: serviceId });
		}
	};

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-medium">Deployments</h2>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>

			{cachedExplanation.data && latestError && (
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
					<p className="text-muted-foreground">
						<span className="font-medium text-foreground">Deploy Copilot</span> analyzed the latest
						failure ({cachedExplanation.data.model}).
					</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() => setExplainResult(cachedExplanation.data ?? null)}
					>
						<Bot className="size-4" />
						View analysis
					</Button>
				</div>
			)}

			{deploymentsQuery.isLoading ? (
				<div className="flex flex-col gap-2">
					{["one", "two", "three"].map((row) => (
						<Skeleton key={row} className="h-10 w-full" />
					))}
				</div>
			) : deployments.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					No deployments yet. Hit Deploy to ship the first one.
				</p>
			) : (
				<TableCard>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Title</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="hidden md:table-cell">Created</TableHead>
								<TableHead className="hidden md:table-cell">Duration</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{deployments.map((deployment) => (
								<TableRow key={deployment.deploymentId}>
									<TableCell className="font-medium">
										<span className="flex flex-wrap items-center gap-1.5">
											{deployment.title}
											{deployment.trigger && (
												<Badge
													variant="outline"
													className="font-normal text-muted-foreground"
													title={describeTriggeredBy(deployment) ?? undefined}
												>
													{TRIGGER_LABELS[deployment.trigger] ?? deployment.trigger}
												</Badge>
											)}
										</span>
										{deployment.commitSha && (
											<span className="mt-0.5 flex max-w-[55vw] items-center gap-1.5 text-xs font-normal text-muted-foreground sm:max-w-md">
												{(() => {
													const sha = deployment.commitSha;
													const href = commitUrl?.(sha) ?? null;
													return href ? (
														<a
															href={href}
															target="_blank"
															rel="noreferrer"
															className="shrink-0 font-mono text-foreground underline-offset-2 hover:underline"
															title={sha}
														>
															{shortSha(sha)}
														</a>
													) : (
														<span className="shrink-0 font-mono text-foreground" title={sha}>
															{shortSha(sha)}
														</span>
													);
												})()}
												{firstLine(deployment.commitMessage) && (
													<span className="truncate" title={deployment.commitMessage ?? undefined}>
														{firstLine(deployment.commitMessage)}
													</span>
												)}
												{deployment.commitAuthor && (
													<span className="shrink-0">· {deployment.commitAuthor}</span>
												)}
											</span>
										)}
										{!deployment.commitSha && describeTriggeredBy(deployment) && (
											<span className="block text-xs font-normal text-muted-foreground">
												{describeTriggeredBy(deployment)}
											</span>
										)}
										{deployment.errorMessage && (
											<span className="block max-w-[55vw] truncate text-xs font-normal text-destructive sm:max-w-md">
												{deployment.errorMessage}
											</span>
										)}
										{/* Phones drop the Created and Duration columns; the same facts fold
										    under the title so the row still answers "when" and "how long". */}
										<span className="mt-0.5 block text-xs font-normal text-muted-foreground md:hidden">
											<DateTime value={deployment.createdAt} /> ·{" "}
											{formatDuration(deployment.startedAt, deployment.finishedAt)}
										</span>
									</TableCell>
									<TableCell>
										<DeploymentStatusBadge
											status={deployment.status}
											queuePosition={deployment.queuePosition}
										/>
									</TableCell>
									<TableCell className="hidden text-muted-foreground md:table-cell">
										<DateTime value={deployment.createdAt} />
									</TableCell>
									<TableCell className="hidden text-muted-foreground md:table-cell">
										{formatDuration(deployment.startedAt, deployment.finishedAt)}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setLogDeployment(deployment)}
											>
												<ScrollText className="size-4" />
												Logs
											</Button>
											{deployment.status === "error" && (
												<Button
													variant="ghost"
													size="sm"
													disabled={explain.isPending || !canExplain}
													title={canExplain ? undefined : capabilityHint("ai.use")}
													onClick={() => explain.mutate({ deploymentId: deployment.deploymentId })}
												>
													{explain.isPending &&
													explain.variables?.deploymentId === deployment.deploymentId ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Bot className="size-4" />
													)}
													Explain
												</Button>
											)}
											{canCancel && isActive(deployment.status) && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														cancel.mutate({
															deploymentId: deployment.deploymentId,
														})
													}
													disabled={cancel.isPending || !canDeploy}
													title={canDeploy ? undefined : capabilityHint("service.deploy")}
												>
													<Ban className="size-4" />
													Cancel
												</Button>
											)}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableCard>
			)}

			{deploymentsQuery.hasNextPage && (
				<div className="flex justify-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => deploymentsQuery.fetchNextPage()}
						disabled={deploymentsQuery.isFetchingNextPage}
					>
						<ChevronDown className="size-4" />
						{deploymentsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}

			<Dialog open={logDeployment !== null} onOpenChange={(open) => !open && closeLogs()}>
				<DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] flex-col sm:max-w-5xl">
					<DialogHeader>
						<DialogTitle>{openLogDeployment?.title ?? "Deployment logs"}</DialogTitle>
						<DialogDescription>
							{openLogDeployment && (
								<>
									<DateTime value={openLogDeployment.createdAt} mode="absolute" /> ·{" "}
									{deploymentStatusLabel[openLogDeployment.status] ?? openLogDeployment.status}
								</>
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 flex-1">
						{logDeployment && (
							<LogViewer
								deploymentId={logDeployment.deploymentId}
								onFinish={() => {
									invalidateList();
									invalidateServiceStatus();
								}}
							/>
						)}
					</div>
				</DialogContent>
			</Dialog>

			<Dialog
				open={explainResult !== null}
				onOpenChange={(open) => !open && setExplainResult(null)}
			>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Bot className="size-4" />
							Deploy Copilot
						</DialogTitle>
						<DialogDescription>
							{explainResult ? `Analyzed with ${explainResult.model}` : ""}
						</DialogDescription>
					</DialogHeader>
					{explainResult && (
						<div className="grid gap-4 text-sm">
							<div>
								<p className="mb-1 font-medium">Summary</p>
								<p className="text-muted-foreground whitespace-pre-wrap">{explainResult.summary}</p>
							</div>
							<div>
								<p className="mb-1 font-medium">Root cause</p>
								<p className="text-muted-foreground">{explainResult.rootCause}</p>
							</div>
							{explainResult.steps.length > 0 && (
								<div>
									<p className="mb-1 font-medium">Suggested steps</p>
									<ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
										{explainResult.steps.map((step, index) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: model-generated free text can repeat; the list is static once rendered
											<li key={index}>{step}</li>
										))}
									</ol>
								</div>
							)}
							{explainResult.suggestedPatch && (
								<div>
									<p className="mb-1 font-medium">Suggested patch</p>
									<pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
										{explainResult.suggestedPatch}
									</pre>
								</div>
							)}
						</div>
					)}
					<DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
						<p className="text-muted-foreground text-xs">
							Env KEY=VALUE patches can be applied automatically; other fixes need a manual edit.
						</p>
						<div className="flex flex-wrap gap-2">
							{explainResult?.suggestedPatch && (
								<Button
									disabled={applyPatch.isPending || redeployPending || !canApplyPatch}
									title={
										canApplyPatch
											? undefined
											: capabilityHint("ai.use", "secrets.write", "service.deploy")
									}
									onClick={() =>
										applyPatch.mutate({
											deploymentId: explainResult.deploymentId,
											patch: explainResult.suggestedPatch ?? undefined,
											redeploy: true,
										})
									}
								>
									{applyPatch.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<RefreshCw className="size-4" />
									)}
									Apply env & redeploy
								</Button>
							)}
							<Button
								variant={explainResult?.suggestedPatch ? "outline" : "default"}
								disabled={redeployPending || applyPatch.isPending || !canDeploy}
								title={canDeploy ? undefined : capabilityHint("service.deploy")}
								onClick={onRedeploy}
							>
								{redeployPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								Redeploy
							</Button>
						</div>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
