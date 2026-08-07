"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

type Metric = "cpu" | "memory" | "restarts" | "deploy_failure_streak";

export function ServiceAlertRulesCard({
	applicationId,
	composeId,
}: {
	applicationId?: string;
	composeId?: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [metric, setMetric] = useState<Metric>("cpu");
	const [threshold, setThreshold] = useState("80");

	const rules = useQuery(trpc.observability.alertRules.queryOptions({ applicationId, composeId }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: trpc.observability.alertRules.pathKey() });

	const upsert = useMutation(
		trpc.observability.upsertAlertRule.mutationOptions({
			onSuccess: () => {
				toast.success("Alert rule saved");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.observability.deleteAlertRule.mutationOptions({
			onSuccess: () => {
				toast.success("Alert rule removed");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Alert rules</CardTitle>
				<CardDescription>
					Per-service CPU, memory, restart, and deploy-failure thresholds. Notify via Settings →
					Notifications (Service alerts).
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{rules.isLoading ? (
					<Skeleton className="h-12 w-full" />
				) : rules.isError ? (
					<div className="flex flex-col gap-2">
						<p className="text-sm text-muted-foreground">
							{rules.error.message || "Failed to load alert rules"}
						</p>
						<Button size="sm" variant="outline" className="w-fit" onClick={() => rules.refetch()}>
							Retry
						</Button>
					</div>
				) : (rules.data ?? []).length === 0 ? (
					<p className="text-sm text-muted-foreground">No rules yet.</p>
				) : (
					<div className="flex flex-col gap-2">
						{(rules.data ?? []).map((rule) => (
							<div
								key={rule.alertRuleId}
								className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
							>
								<div>
									<span className="font-medium">{rule.metric}</span>
									<span className="text-muted-foreground"> ≥ {rule.threshold}</span>
									{!rule.enabled && (
										<span className="ml-2 text-xs text-muted-foreground">(disabled)</span>
									)}
								</div>
								<div className="flex items-center gap-2">
									<Switch
										checked={rule.enabled}
										onCheckedChange={(enabled) =>
											upsert.mutate({
												alertRuleId: rule.alertRuleId,
												metric: rule.metric as Metric,
												threshold: rule.threshold,
												enabled,
												applicationId,
												composeId,
											})
										}
									/>
									<Button
										variant="ghost"
										size="icon"
										aria-label="Remove alert rule"
										onClick={() => remove.mutate({ alertRuleId: rule.alertRuleId })}
									>
										<Trash2 className="size-4 text-destructive" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}

				<div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
					<div className="grid gap-1.5">
						<Label>Metric</Label>
						<Select value={metric} onValueChange={(value) => setMetric(value as Metric)}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="cpu">CPU %</SelectItem>
								<SelectItem value="memory">Memory %</SelectItem>
								<SelectItem value="restarts">Restart count</SelectItem>
								<SelectItem value="deploy_failure_streak">Deploy failure streak</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-1.5">
						<Label>Threshold</Label>
						<Input
							type="number"
							min={1}
							value={threshold}
							onChange={(event) => setThreshold(event.target.value)}
						/>
					</div>
					<Button
						disabled={upsert.isPending}
						onClick={() =>
							upsert.mutate({
								applicationId,
								composeId,
								metric,
								threshold: Number(threshold),
								enabled: true,
							})
						}
					>
						{upsert.isPending ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Plus className="size-4" />
						)}
						Add
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
