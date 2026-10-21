"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { RuntimeLogHistory } from "@/components/services/runtime-log-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/ui/date-time";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useRunningDeployments } from "@/hooks/use-running-deployments";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

const RECOVERY_LABEL = {
	applying: "Starting recovery",
	queued: "Recovery queued",
	running: "Recovery running",
	completed: "Recovery operation completed",
	failed: "Recovery needs attention",
	unknown: "Recovery result unavailable",
};

export function IncidentWorkbench({
	incidentId,
	onClose,
}: {
	incidentId: string;
	onClose: () => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can } = useCapabilities();
	const [note, setNote] = useState("");
	const [showLogs, setShowLogs] = useState(false);
	const [diagnosing, setDiagnosing] = useState<string | null>(null);
	const query = useQuery(trpc.observability.incident.queryOptions({ incidentId }));
	const data = query.data;
	const { deployments } = useRunningDeployments();
	const invalidate = [
		trpc.observability.incidents.pathKey(),
		trpc.observability.incidentPage.pathKey(),
		trpc.observability.incident.queryKey({ incidentId }),
	];
	const refresh = () =>
		Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
	const acknowledge = useSaveMutation(trpc.observability.acknowledgeIncident.mutationOptions(), {
		invalidate,
		successMessage: "Incident acknowledged",
	});
	const resolve = useSaveMutation(trpc.observability.resolveIncident.mutationOptions(), {
		invalidate,
		successMessage: "Incident resolved",
	});
	const apply = useSaveMutation(
		trpc.observability.applyRemediation.mutationOptions({
			onError: () => {
				void refresh();
			},
		}),
		{
			invalidate: [...invalidate, trpc.deployment.recent.pathKey()],
			successMessage: "Recovery requested. Verify the result before resolving.",
		},
	);
	const dismiss = useSaveMutation(trpc.observability.dismissRemediation.mutationOptions(), {
		invalidate,
		successMessage: "Proposal dismissed",
	});
	const diagnosis = useQuery({
		...trpc.domain.diagnose.queryOptions({ domainId: diagnosing ?? "" }),
		enabled: false,
		staleTime: Infinity,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const runDiagnosis = (domainId: string) => {
		setDiagnosing(domainId);
		// An explicit fetch, with the observer disabled, keeps cache invalidation,
		// focus and reconnect from silently starting another probe container.
		void queryClient
			.fetchQuery({
				...trpc.domain.diagnose.queryOptions({ domainId }),
				staleTime: 0,
				retry: false,
			})
			.catch(() => {
				// QueryState renders the query's error and its explicit Retry action.
			});
	};

	const canManage = can("project.write");
	const canApply = can("service.deploy") && can("secrets.write");
	const canRuntime = can("service.runtime");
	const service = data?.service;
	const serviceHref = service
		? "/dashboard/projects/" +
			service.projectId +
			"/services/" +
			service.kind +
			"/" +
			service.serviceId
		: null;
	const liveRecovery = deployments.find((row) => row.deploymentId === data?.recovery?.deploymentId);
	const recoveryState = liveRecovery
		? liveRecovery.status === "done"
			? "completed"
			: liveRecovery.status === "error" || liveRecovery.status === "cancelled"
				? "failed"
				: liveRecovery.status === "queued" || liveRecovery.status === "running"
					? liveRecovery.status
					: data?.recovery?.state
		: data?.recovery?.state;
	const recoveryActive =
		recoveryState === "applying" || recoveryState === "queued" || recoveryState === "running";
	const proposal =
		data?.incident.kind === "remediation"
			? (data.incident.metadata?.proposal as
					| { action?: { type?: string; image?: string; sourceDeploymentId?: string } }
					| undefined)
			: undefined;
	const action = proposal?.action;
	const applyLabel =
		action?.type === "rollback_application"
			? `Roll back to ${action.image}`
			: action?.type === "rollback_compose"
				? "Restore previous deployment"
				: null;
	return (
		<section
			className="min-w-0 overflow-hidden rounded-lg border bg-card"
			aria-label="Incident investigation"
		>
			<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
				<h3 className="text-sm font-medium">Investigation</h3>
				<div className="flex gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Refresh incident"
						onClick={() => {
							void query.refetch();
							void refresh();
						}}
					>
						<RefreshCw className="size-3.5" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Close investigation"
						onClick={onClose}
					>
						<X className="size-3.5" />
					</Button>
				</div>
			</div>
			<QueryState
				isPending={query.isPending}
				isError={query.isError}
				error={query.error}
				onRetry={() => void query.refetch()}
				isEmpty={false}
				empty={null}
				skeleton={<Skeleton className="m-4 h-64" />}
			>
				{data && (
					<div className="flex flex-col gap-5 p-4 sm:p-5">
						<div className="flex flex-col gap-2">
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant={data.incident.resolvedAt ? "secondary" : "outline"}>
									{data.incident.resolvedAt
										? "Resolved"
										: data.incident.acknowledgedAt
											? "Acknowledged"
											: "Open"}
								</Badge>
								<span className="text-xs text-muted-foreground">
									{data.incident.severity} · <DateTime value={data.incident.createdAt} />
								</span>
							</div>
							<h4 className="break-words text-lg font-semibold tracking-tight">
								{data.incident.title}
							</h4>
							<p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
								{data.incident.message}
							</p>
							{service && serviceHref ? (
								<Link href={serviceHref} className="text-sm underline underline-offset-4">
									{service.projectName} / {service.environmentName} / {service.name}
								</Link>
							) : (
								<p className="text-xs text-muted-foreground">
									No accessible service is linked to this incident. Its recorded evidence remains
									below.
								</p>
							)}
						</div>
						{data.recovery && recoveryState && (
							<div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4" role="status">
								<p className="text-sm font-medium">{RECOVERY_LABEL[recoveryState]}</p>
								<p className="text-xs text-muted-foreground">
									{recoveryActive
										? "The operation is still in progress. This incident remains open."
										: recoveryState === "unknown"
											? "The recovery did not report a result or its deployment is unavailable. Inspect the service before recording a manual resolution. This action will not be replayed."
											: "Operation completion does not establish application health. Inspect the evidence, verify the service, then record your conclusion."}
								</p>
								{(liveRecovery?.errorMessage ?? data.recovery.error) && (
									<p className="break-words text-xs text-destructive">
										{liveRecovery?.errorMessage ?? data.recovery.error}
									</p>
								)}
								{data.recovery.deploymentId && serviceHref && (
									<Button asChild size="sm" variant="outline" className="self-start">
										<Link
											href={`${serviceHref}?tab=deployments&deployment=${data.recovery.deploymentId}`}
										>
											View recovery deployment
											<ExternalLink className="size-3.5" />
										</Link>
									</Button>
								)}
							</div>
						)}
						{data.incident.resolvedAt ? (
							<div className="rounded-lg border bg-muted/30 p-4">
								<p className="flex items-center gap-2 text-sm font-medium">
									<Check className="size-4" />
									Resolved <DateTime value={data.incident.resolvedAt} />
								</p>
								{typeof data.incident.metadata?.resolutionNote === "string" && (
									<p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
										{data.incident.metadata.resolutionNote}
									</p>
								)}
							</div>
						) : (
							<>
								{!data.recovery && proposal && (
									<div className="flex flex-col gap-3 rounded-lg border p-4">
										<p className="text-sm font-medium">Proposed recovery</p>
										<p className="text-xs text-muted-foreground">
											{applyLabel
												? "This changes the running service. Apply once, follow the operation, then verify its health."
												: "There is no automatic action for this proposal. Inspect the service before recording a resolution."}
										</p>
										<div className="flex flex-wrap gap-2">
											{applyLabel && (
												<DisabledHint
													hint={canApply ? undefined : capabilityHint("service.deploy")}
												>
													<Button
														type="button"
														size="sm"
														disabled={!canApply || apply.isPending || dismiss.isPending}
														onClick={() => apply.mutate({ incidentId })}
													>
														{apply.isPending && <Loader2 className="size-3.5 animate-spin" />}
														{applyLabel}
													</Button>
												</DisabledHint>
											)}
											<DisabledHint hint={canManage ? undefined : capabilityHint("project.write")}>
												<Button
													type="button"
													size="sm"
													variant="outline"
													disabled={!canManage || dismiss.isPending || apply.isPending}
													onClick={() => dismiss.mutate({ incidentId })}
												>
													Dismiss proposal
												</Button>
											</DisabledHint>
										</div>
									</div>
								)}
								<div className="flex flex-col gap-3 border-t pt-4">
									<div className="flex items-center justify-between gap-2">
										<h5 className="text-sm font-medium">Verify and resolve</h5>
										{!data.incident.acknowledgedAt && (
											<DisabledHint hint={canManage ? undefined : capabilityHint("project.write")}>
												<Button
													type="button"
													size="sm"
													variant="outline"
													disabled={!canManage || acknowledge.isPending}
													onClick={() => acknowledge.mutate({ incidentId })}
												>
													Acknowledge
												</Button>
											</DisabledHint>
										)}
									</div>
									<Label htmlFor={`resolution-${incidentId}`}>What did you verify?</Label>
									<Textarea
										id={`resolution-${incidentId}`}
										value={note}
										onChange={(event) => setNote(event.target.value)}
										maxLength={1000}
										rows={3}
										placeholder="For example: checked the route and confirmed a successful database-backed request."
										disabled={!canManage}
									/>
									<p className="text-xs text-muted-foreground">
										{recoveryActive
											? "Wait for the recovery operation to finish before resolving."
											: "Record the check you performed. Resolving records your conclusion and does not run a health check."}
									</p>
									<DisabledHint hint={canManage ? undefined : capabilityHint("project.write")}>
										<Button
											type="button"
											size="sm"
											className="self-start"
											disabled={
												!canManage ||
												!note.trim() ||
												recoveryActive ||
												resolve.isPending ||
												apply.isPending
											}
											onClick={() => resolve.mutate({ incidentId, note: note.trim() })}
										>
											{resolve.isPending && <Loader2 className="size-3.5 animate-spin" />}Resolve
											with verification note
										</Button>
									</DisabledHint>
								</div>
							</>
						)}
						{serviceHref && (
							<div className="flex flex-col gap-3 border-t pt-4">
								<h5 className="text-sm font-medium">Evidence</h5>
								<div className="flex flex-wrap gap-2">
									{data.sourceDeployment && (
										<Button asChild size="sm" variant="outline">
											<Link
												href={
													serviceHref +
													"?tab=deployments&deployment=" +
													data.sourceDeployment.deploymentId
												}
											>
												View failed deployment
											</Link>
										</Button>
									)}
									<Button asChild size="sm" variant="outline">
										<Link href={`${serviceHref}?tab=events`}>Service events</Link>
									</Button>
									<Button asChild size="sm" variant="outline">
										<Link href={`${serviceHref}?tab=monitoring`}>Service metrics</Link>
									</Button>
									<DisabledHint hint={canRuntime ? undefined : capabilityHint("service.runtime")}>
										<Button
											type="button"
											size="sm"
											variant="outline"
											aria-expanded={showLogs}
											disabled={!canRuntime}
											onClick={() => setShowLogs((value) => !value)}
										>
											{showLogs ? "Hide runtime evidence" : "Runtime logs around incident"}
										</Button>
									</DisabledHint>
								</div>
								{showLogs && service && (
									<RuntimeLogHistory
										appName={service.appName}
										since={new Date(data.incident.createdAt).getTime() - 15 * 60_000}
										until={new Date(data.incident.createdAt).getTime() + 15 * 60_000}
									/>
								)}
							</div>
						)}
						{data.domains.length > 0 && (
							<div className="flex flex-col gap-3 border-t pt-4">
								<h5 className="text-sm font-medium">Routes</h5>
								{data.domains.map((domain) => (
									<div
										key={domain.domainId}
										className="flex min-w-0 flex-wrap items-center justify-between gap-2"
									>
										<span className="min-w-0 break-all font-mono text-xs">
											{domain.host}
											{domain.path === "/" ? "" : domain.path}
										</span>
										<DisabledHint hint={canRuntime ? undefined : capabilityHint("service.runtime")}>
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={!canRuntime || diagnosis.isFetching}
												onClick={() => runDiagnosis(domain.domainId)}
											>
												Diagnose route
											</Button>
										</DisabledHint>
									</div>
								))}
								<p className="text-xs text-muted-foreground">
									Diagnosis runs only when requested and can start a temporary network probe.
								</p>
								{diagnosing && (
									<QueryState
										isPending={diagnosis.isPending}
										isError={diagnosis.isError}
										error={diagnosis.error}
										onRetry={() => diagnosing && runDiagnosis(diagnosing)}
										isEmpty={false}
										empty={null}
									>
										<div className="rounded-lg border p-3">
											<p className="mb-2 text-sm font-medium">
												{diagnosis.data?.host} · {diagnosis.data?.verdict}
											</p>
											<ul className="flex flex-col gap-3">
												{diagnosis.data?.findings.map((finding) => (
													<li key={finding.id} className="text-xs">
														<p className="font-medium">
															{finding.status}: {finding.title}
														</p>
														<p className="text-muted-foreground">{finding.detail}</p>
														{finding.fix && <p className="mt-1">{finding.fix}</p>}
													</li>
												))}
											</ul>
										</div>
									</QueryState>
								)}
							</div>
						)}
					</div>
				)}
			</QueryState>
		</section>
	);
}
