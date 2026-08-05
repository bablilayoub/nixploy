"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Ban, ChevronDown, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LogViewer } from "@/components/services/log-viewer";
import { StatusDot, type StatusDotStatus } from "@/components/shell";
import { Button } from "@/components/ui/button";
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

import type { Application, Deployment } from "./types";

const PAGE_SIZE = 10;

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

	const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery(
		trpc.deployment.byApplication.infiniteQueryOptions(
			{ applicationId, limit: PAGE_SIZE },
			{ getNextPageParam: (lastPage) => lastPage.nextCursor },
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

	const deployments = data?.pages.flatMap((page) => page.deployments) ?? [];

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-medium">Deployments</h2>
				<p className="text-sm text-muted-foreground">
					Build and deployment history for this application.
				</p>
			</div>

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
		</section>
	);
}
