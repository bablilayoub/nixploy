"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

export function QuotasCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());
	// The dashboard layout (branding provider) starts this same query, so it
	// can already be resolved when this page segment hydrates — keep the
	// server-rendered skeleton until mount so both paints agree.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const { can } = useCapabilities();
	const canManage = can("settings.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("settings.manage");

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

	if (!mounted || settingsQuery.isPending) {
		return (
			<SettingsSection
				title="Quotas"
				description="Resource limits for this organization. Leave blank for unlimited. Owner or admin required to edit."
			>
				<Skeleton className="h-24 w-full" />
			</SettingsSection>
		);
	}

	if (settingsQuery.isError) {
		return (
			<SettingsSection
				title="Quotas"
				description="Resource limits for this organization. Leave blank for unlimited. Owner or admin required to edit."
			>
				<div className="flex flex-col items-center gap-2 py-8 text-center">
					<p className="text-sm font-medium">Could not load quotas</p>
					<p className="text-sm text-muted-foreground">
						{settingsQuery.error.message || "Try again in a moment."}
					</p>
					<Button variant="outline" size="sm" onClick={() => void settingsQuery.refetch()}>
						Retry
					</Button>
				</div>
			</SettingsSection>
		);
	}

	if (!settingsQuery.data) return null;

	const { usage } = settingsQuery.data;

	return (
		<SettingsSection
			title="Quotas"
			description="Resource limits for this organization. Leave blank for unlimited. Owner or admin required to edit."
		>
			<form onSubmit={onSubmit} className="grid gap-4">
				<p className="text-sm text-muted-foreground">
					Current usage: {usage.projects} projects, {usage.services} services
				</p>
				<fieldset disabled={!canManage} title={manageHint} className="contents">
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
				</fieldset>
				<div>
					<Button type="submit" disabled={!canManage || save.isPending} title={manageHint}>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save quotas
					</Button>
				</div>
			</form>
		</SettingsSection>
	);
}
