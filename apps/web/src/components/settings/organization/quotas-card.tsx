"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useTRPC } from "@/lib/trpc";

export function QuotasCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());

	const [maxProjects, setMaxProjects] = useState("");
	const [maxServices, setMaxServices] = useState("");
	const [maxCpuShares, setMaxCpuShares] = useState("");
	const [maxMemoryMb, setMaxMemoryMb] = useState("");

	useEffect(() => {
		if (!settingsQuery.data) return;
		const { quotas } = settingsQuery.data;
		setMaxProjects(quotas.maxProjects?.toString() ?? "");
		setMaxServices(quotas.maxServices?.toString() ?? "");
		setMaxCpuShares(quotas.maxCpuShares?.toString() ?? "");
		setMaxMemoryMb(quotas.maxMemoryMb?.toString() ?? "");
	}, [settingsQuery.data]);

	const save = useMutation({
		...trpc.organization.updateSettings.mutationOptions(),
		onSuccess: async () => {
			toast.success("Quotas updated");
			await queryClient.invalidateQueries({ queryKey: trpc.organization.settings.queryKey() });
		},
		onError: (error) => toast.error(error.message),
	});

	function parseLimit(value: string): number | null {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number.parseInt(trimmed, 10);
		return Number.isNaN(parsed) ? null : parsed;
	}

	function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		save.mutate({
			quotas: {
				maxProjects: parseLimit(maxProjects),
				maxServices: parseLimit(maxServices),
				maxCpuShares: parseLimit(maxCpuShares),
				maxMemoryMb: parseLimit(maxMemoryMb),
			},
		});
	}

	if (settingsQuery.isPending) {
		return (
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-32" />
					<Skeleton className="h-4 w-64" />
				</CardHeader>
				<CardContent>
					<Skeleton className="h-24 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (settingsQuery.error || !settingsQuery.data) return null;

	const { usage } = settingsQuery.data;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Gauge className="size-4 text-muted-foreground" />
					Quotas
				</CardTitle>
				<CardDescription>
					Resource limits for this organization. Leave blank for unlimited. Owner or admin required
					to edit.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSubmit} className="grid max-w-md gap-4">
					<p className="text-sm text-muted-foreground">
						Current usage: {usage.projects} projects, {usage.services} services
					</p>
					<div className="grid gap-2">
						<Label htmlFor="max-projects">Max projects</Label>
						<Input
							id="max-projects"
							type="number"
							min={0}
							placeholder="Unlimited"
							value={maxProjects}
							onChange={(e) => setMaxProjects(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="max-services">Max services</Label>
						<Input
							id="max-services"
							type="number"
							min={0}
							placeholder="Unlimited"
							value={maxServices}
							onChange={(e) => setMaxServices(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="max-cpu">Max CPU shares</Label>
						<Input
							id="max-cpu"
							type="number"
							min={0}
							placeholder="Unlimited"
							value={maxCpuShares}
							onChange={(e) => setMaxCpuShares(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="max-memory">Max memory (MB)</Label>
						<Input
							id="max-memory"
							type="number"
							min={0}
							placeholder="Unlimited"
							value={maxMemoryMb}
							onChange={(e) => setMaxMemoryMb(e.target.value)}
						/>
					</div>
					<div>
						<Button type="submit" disabled={save.isPending}>
							{save.isPending && <Loader2 className="size-4 animate-spin" />}
							Save quotas
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
