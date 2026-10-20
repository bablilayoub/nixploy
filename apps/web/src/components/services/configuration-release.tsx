"use client";

import type { ConfigurationScope } from "@nixploy/server/modules/configuration-release/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { describeError, toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

/** Review saved drafts. This component never sends a save or a runtime mutation. */
export function ConfigurationRelease({ scope }: { scope: ConfigurationScope }) {
	const trpc = useTRPC();
	const controlPrefix = useId();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const review = useQuery({
		...trpc.configurationRelease.review.queryOptions({ scope }),
		enabled: open,
		refetchOnWindowFocus: false,
	});
	const { deployments } = useRunningDeployments();
	const canApply = can("secrets.write") && can("service.deploy");
	const apply = useMutation(
		trpc.configurationRelease.deployReviewed.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					`${result.deployments.length} ${result.deployments.length === 1 ? "deployment" : "deployments"} queued`,
				);
				void queryClient.invalidateQueries({ queryKey: trpc.deployment.recent.queryKey() });
			},
			onError: (error) => toastError(error),
		}),
	);
	const token = review.data?.token;
	useEffect(() => {
		if (!token) return;
		setSelected(
			new Set(
				(review.data?.targets ?? [])
					.filter((target) => target.pending && target.canDeploy)
					.map((target) => `${target.kind}:${target.id}`),
			),
		);
	}, [token, review.data?.targets]);
	const refresh = () => {
		apply.reset();
		void review.refetch();
	};
	const targets = review.data?.targets ?? [];
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
				<p className="text-sm text-muted-foreground">
					Save a draft, then review its effect before deploying.
				</p>
				<DialogTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							apply.reset();
						}}
					>
						{scope.kind === "project"
							? "Review project changes"
							: scope.kind === "environment"
								? "Review environment changes"
								: scope.kind === "organization"
									? "Review shared changes"
									: "Review saved changes"}
					</Button>
				</DialogTrigger>
			</div>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{apply.isSuccess ? "Configuration release queued" : "Review variable changes"}
					</DialogTitle>
					<DialogDescription>
						Organization → project → environment → service. Lower levels win, including empty
						values. Values stay hidden in this review.
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
					{review.isPending ? (
						<Skeleton className="h-40 w-full" />
					) : review.isError ? (
						<div role="alert" className="space-y-3">
							<p className="text-sm text-destructive">{describeError(review.error)}</p>
							<Button variant="outline" onClick={refresh}>
								Retry review
							</Button>
						</div>
					) : apply.isSuccess ? (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground">
								Each job uses the encrypted variables approved in this review. Later edits need
								another deployment.
							</p>
							<ul className="divide-y divide-border rounded-lg border border-border">
								{apply.data.deployments.map((job) => {
									const target = targets.find(
										(target) => target.id === job.id && target.kind === job.kind,
									);
									const status = deployments.find(
										(deployment) => deployment.deploymentId === job.deploymentId,
									)?.status;
									return (
										<li
											key={job.deploymentId}
											className="flex flex-wrap items-center justify-between gap-3 p-3"
										>
											<span className="min-w-0 text-sm">
												<span className="break-words font-medium">{target?.name ?? job.kind}</span>
												<span className="ml-2 text-muted-foreground">
													{status ?? "Queued · open deployment for latest status"}
												</span>
											</span>
											<Button asChild variant="outline" size="sm">
												<Link
													href={`/dashboard/projects/${target?.projectId}/services/${job.kind}/${job.id}?tab=deployments&deployment=${job.deploymentId}`}
												>
													View deployment
												</Link>
											</Button>
										</li>
									);
								})}
							</ul>
							<p className="text-xs text-muted-foreground">
								Application rollout waits for the new deployment’s desired replicas. Running state
								does not verify HTTP readiness. Compose reports command completion.
							</p>
						</div>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								Compared with each service’s last successful saved deployment. Older deployments may
								have no recorded configuration.
							</p>
							{targets.length === 0 ? (
								<p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
									No applications or Compose stacks in this scope. Managed databases are excluded.
								</p>
							) : (
								<ul className="divide-y divide-border rounded-lg border border-border">
									{targets.map((target) => {
										const key = `${target.kind}:${target.id}`;
										return (
											<li key={key} className="p-3">
												<label
													htmlFor={`${controlPrefix}-${key}`}
													className="flex min-h-11 cursor-pointer items-start gap-3"
												>
													<Checkbox
														id={`${controlPrefix}-${key}`}
														className="mt-1"
														checked={selected.has(key)}
														disabled={!canApply || !target.canDeploy || apply.isPending}
														onCheckedChange={(checked) =>
															setSelected((current) => {
																const next = new Set(current);
																if (checked) next.add(key);
																else next.delete(key);
																return next;
															})
														}
														aria-label={`Deploy ${target.name}`}
													/>
													<span className="min-w-0 flex-1">
														<span className="flex flex-wrap items-baseline justify-between gap-2">
															<span className="break-words text-sm font-medium">{target.name}</span>
															<span className="text-xs text-muted-foreground">
																{target.kind === "compose" ? "Compose" : "Application"}
															</span>
														</span>
														<span className="mt-1 block text-xs text-muted-foreground">
															{target.baseline === "unknown"
																? "No saved successful configuration"
																: target.pending
																	? `${target.variableChanges} variable changes · ${target.buildArgumentChanges} build argument changes`
																	: "Effective variables unchanged"}
														</span>
														{!target.canDeploy && (
															<span className="mt-1 block text-xs text-destructive">
																{target.reason}
															</span>
														)}
													</span>
												</label>
												{target.changes &&
													(target.changes.length > 0 || (target.buildChanges?.length ?? 0) > 0) && (
														<details className="ml-7 text-xs">
															<summary className="cursor-pointer py-2 text-muted-foreground">
																Variable names and origins
															</summary>
															<ul className="space-y-2 pb-2">
																{target.changes.map((change) => (
																	<li
																		key={change.key}
																		className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
																	>
																		<code className="break-all">{change.key}</code>
																		<span className="text-muted-foreground">
																			{change.change}
																			{change.origin ? ` · ${change.origin}` : ""}
																		</span>
																	</li>
																))}
																{target.buildChanges?.map((change) => (
																	<li
																		key={`build-${change.key}`}
																		className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
																	>
																		<code className="break-all">{change.key}</code>
																		<span className="text-muted-foreground">
																			{change.change} · build argument
																		</span>
																	</li>
																))}
															</ul>
														</details>
													)}
											</li>
										);
									})}
								</ul>
							)}
							{review.data?.redacted && (
								<p className="text-xs text-muted-foreground">
									Variable names are hidden because this account cannot read secrets.
								</p>
							)}
							<p className="text-xs text-muted-foreground">{review.data?.excluded}</p>
							{!canApply && (
								<p className="text-sm text-muted-foreground">
									Deploying requires both edit secrets and deploy permissions.
								</p>
							)}
							{apply.isError && (
								<div role="alert" className="space-y-2">
									<p className="text-sm text-destructive">{describeError(apply.error)}</p>
									<Button type="button" variant="outline" size="sm" onClick={refresh}>
										Review latest changes
									</Button>
								</div>
							)}
						</>
					)}
				</div>
				<DialogFooter className="shrink-0">
					<Button type="button" variant="outline" onClick={() => setOpen(false)}>
						{apply.isSuccess ? "Close" : "Cancel"}
					</Button>
					{!apply.isSuccess && (
						<Button
							type="button"
							disabled={
								!canApply ||
								review.isFetching ||
								review.isError ||
								!token ||
								!selected.size ||
								apply.isPending ||
								apply.isError
							}
							onClick={() => {
								if (token)
									apply.mutate({
										scope,
										reviewToken: token,
										targets: targets
											.filter((target) => selected.has(`${target.kind}:${target.id}`))
											.map(({ kind, id }) => ({ kind, id })),
									});
							}}
						>
							{apply.isPending && <Loader2 className="size-4 animate-spin" />}Deploy selected (
							{selected.size})
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
