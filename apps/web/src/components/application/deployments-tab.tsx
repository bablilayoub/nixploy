"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Ban, Bot, ChevronDown, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LogViewer } from "@/components/services/log-viewer";
import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Button } from "@/components/ui/button";
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
import { useTRPC } from "@/lib/trpc";

import type { Application, Deployment } from "./types";

const PAGE_SIZE = 10;

type ExplainResult = {
	summary: string;
	rootCause: string;
	steps: string[];
	suggestedPatch: string | null;
	model: string;
	deploymentId: string;
};

const STATUS_CONFIG: Record<Deployment["status"], { label: string; status: StatusDotStatus }> = {
	running: { label: "Running", status: "success" },
	done: { label: "Done", status: "info" },
	error: { label: "Error", status: "error" },
	cancelled: { label: "Cancelled", status: "neutral" },
};

const formatDuration = (deployment: Deployment) => {
	if (!deployment.startedAt) return "—";
	const end = deployment.finishedAt ?? new Date();
	const seconds = Math.max(0, Math.round((end.getTime() - deployment.startedAt.getTime()) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
};

export function DeploymentsTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const applicationId = application.applicationId;

	const [logDeployment, setLogDeployment] = useState<Deployment | null>(null);
	const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);

	const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery(
		trpc.deployment.byApplication.infiniteQueryOptions(
			{ applicationId, limit: PAGE_SIZE },
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor,
				refetchInterval: (query) => {
					const pages = query.state.data?.pages ?? [];
					const hasRunning = pages.some((page) =>
						page.deployments.some((deployment) => deployment.status === "running"),
					);
					return hasRunning ? 2_000 : false;
				},
			},
		),
	);

	const cancel = useMutation(
		trpc.application.cancelDeployment.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment cancelled");
				queryClient.invalidateQueries({
					queryKey: trpc.deployment.byApplication.pathKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const explain = useMutation(
		trpc.ai.explainDeployment.mutationOptions({
			onSuccess: (result) => {
				setExplainResult(result);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const redeploy = useMutation(
		trpc.application.redeploy.mutationOptions({
			onSuccess: () => {
				toast.success("Redeploy queued");
				setExplainResult(null);
				queryClient.invalidateQueries({
					queryKey: trpc.deployment.byApplication.pathKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const applyPatch = useMutation(
		trpc.ai.applySuggestedPatch.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					result.deploymentId
						? `Applied ${result.appliedKeys.join(", ")} and queued redeploy`
						: `Applied ${result.appliedKeys.join(", ")}`,
				);
				setExplainResult(null);
				queryClient.invalidateQueries({
					queryKey: trpc.deployment.byApplication.pathKey(),
				});
				queryClient.invalidateQueries({ queryKey: trpc.application.one.queryKey() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const deployments = data?.pages.flatMap((page) => page.deployments) ?? [];
	const latestError = deployments.find((deployment) => deployment.status === "error");

	const cachedExplanation = useQuery({
		...trpc.ai.getExplanation.queryOptions({
			deploymentId: latestError?.deploymentId ?? "",
		}),
		enabled: Boolean(latestError?.deploymentId),
		refetchInterval: (query) => {
			if (query.state.data) return false;
			const finishedAt = latestError?.finishedAt ? new Date(latestError.finishedAt).getTime() : 0;
			// Auto-explain is async — poll for up to 2 minutes after failure.
			if (finishedAt && Date.now() - finishedAt > 120_000) return false;
			return 3_000;
		},
	});

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-medium">Deployments</h2>
				<p className="text-sm text-muted-foreground">
					Build and deployment history for this application.
				</p>
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

			{isLoading ? (
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
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Title</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Duration</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{deployments.map((deployment) => {
								const statusConfig = STATUS_CONFIG[deployment.status] ?? STATUS_CONFIG.cancelled;
								return (
									<TableRow key={deployment.deploymentId}>
										<TableCell className="font-medium">
											{deployment.title}
											{deployment.errorMessage && (
												<span className="block max-w-md truncate text-xs text-destructive">
													{deployment.errorMessage}
												</span>
											)}
										</TableCell>
										<TableCell>
											<span className="inline-flex items-center gap-1.5 text-sm">
												<StatusDot
													status={statusConfig.status}
													className={
														statusConfig.status === "success" ? "animate-pulse" : undefined
													}
												/>
												{statusConfig.label}
											</span>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{format(deployment.createdAt, "MMM d, yyyy HH:mm")}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDuration(deployment)}
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
														disabled={explain.isPending}
														onClick={() =>
															explain.mutate({ deploymentId: deployment.deploymentId })
														}
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
												{deployment.status === "running" && (
													<Button
														variant="ghost"
														size="sm"
														onClick={() =>
															cancel.mutate({
																deploymentId: deployment.deploymentId,
															})
														}
														disabled={cancel.isPending}
													>
														<Ban className="size-4" />
														Cancel
													</Button>
												)}
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}

			{hasNextPage && (
				<div className="flex justify-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => fetchNextPage()}
						disabled={isFetchingNextPage}
					>
						<ChevronDown className="size-4" />
						{isFetchingNextPage ? "Loading…" : "Load more"}
					</Button>
				</div>
			)}

			<Dialog
				open={logDeployment !== null}
				onOpenChange={(open) => !open && setLogDeployment(null)}
			>
				<DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] flex-col sm:max-w-5xl">
					<DialogHeader>
						<DialogTitle>{logDeployment?.title ?? "Deployment logs"}</DialogTitle>
						<DialogDescription>
							{logDeployment &&
								`${format(logDeployment.createdAt, "MMM d, yyyy HH:mm")} · ${logDeployment.status}`}
						</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 flex-1">
						{logDeployment && <LogViewer deploymentId={logDeployment.deploymentId} />}
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
										{explainResult.steps.map((step) => (
											<li key={step}>{step}</li>
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
									disabled={applyPatch.isPending || redeploy.isPending}
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
								disabled={redeploy.isPending || applyPatch.isPending}
								onClick={() => redeploy.mutate({ applicationId })}
							>
								{redeploy.isPending ? (
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
