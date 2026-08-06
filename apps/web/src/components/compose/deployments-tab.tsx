"use client";

import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Bot, Loader2, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ComposeService } from "@/components/compose/compose-detail";
import { LogViewer } from "@/components/services/log-viewer";
import { DeploymentStatusBadge } from "@/components/services/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import type { AppRouter } from "@/lib/trpc-types";

type ComposeDeployment =
	inferRouterOutputs<AppRouter>["deployment"]["byCompose"]["deployments"][number];

type ExplainResult = {
	summary: string;
	rootCause: string;
	steps: string[];
	suggestedPatch: string | null;
	model: string;
	deploymentId: string;
};

const PAGE_SIZE = 10;

const formatDuration = (deployment: ComposeDeployment) => {
	if (!deployment.startedAt) return "—";
	const end = deployment.finishedAt ?? new Date();
	const seconds = Math.max(0, Math.round((end.getTime() - deployment.startedAt.getTime()) / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
};

export function DeploymentsTab({ compose }: { compose: ComposeService }) {
	const trpc = useTRPC();
	const [logDeployment, setLogDeployment] = useState<ComposeDeployment | null>(null);
	const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);

	const deploymentsQuery = useInfiniteQuery(
		trpc.deployment.byCompose.infiniteQueryOptions(
			{ composeId: compose.composeId, limit: PAGE_SIZE },
			{ getNextPageParam: (lastPage) => lastPage.nextCursor },
		),
	);

	const explain = useMutation(
		trpc.ai.explainDeployment.mutationOptions({
			onSuccess: (result) => setExplainResult(result),
			onError: (error) => toast.error(error.message),
		}),
	);

	const deployments = deploymentsQuery.data?.pages.flatMap((page) => page.deployments) ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Deployments</CardTitle>
				<CardDescription>Build and deployment history for this compose service.</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
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
							{deployments.map((deployment) => (
								<TableRow key={deployment.deploymentId}>
									<TableCell className="font-medium">
										{deployment.title}
										{deployment.errorMessage && (
											<span className="block max-w-md truncate text-sm text-destructive">
												{deployment.errorMessage}
											</span>
										)}
									</TableCell>
									<TableCell>
										<DeploymentStatusBadge status={deployment.status} />
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
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}

				{deploymentsQuery.hasNextPage && (
					<div className="flex justify-center">
						<Button
							variant="outline"
							size="sm"
							disabled={deploymentsQuery.isFetchingNextPage}
							onClick={() => deploymentsQuery.fetchNextPage()}
						>
							{deploymentsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
						</Button>
					</div>
				)}
			</CardContent>

			<Dialog
				open={logDeployment !== null}
				onOpenChange={(open) => !open && setLogDeployment(null)}
			>
				<DialogContent className="flex max-h-[85vh] max-w-4xl flex-col">
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
				</DialogContent>
			</Dialog>
		</Card>
	);
}
