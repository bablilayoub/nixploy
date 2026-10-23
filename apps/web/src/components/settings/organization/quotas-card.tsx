"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { SettingsSection } from "@/components/layout/settings-section";
import { useSaveBar } from "@/components/services/save-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useMounted } from "@/hooks/use-mounted";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

function parseLimit(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

export function QuotasCard() {
	const trpc = useTRPC();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());
	// The dashboard layout (branding provider) starts this same query, so it
	// can already be resolved when this page segment hydrates — keep the
	// server-rendered skeleton until mount so both paints agree.
	const mounted = useMounted();
	const { can } = useCapabilities();
	const canManage = can("settings.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("settings.manage");

	const quotas = settingsQuery.data?.quotas;
	const draft = useDraft({
		maxProjects: quotas?.maxProjects?.toString() ?? "",
		maxServices: quotas?.maxServices?.toString() ?? "",
		maxCpuShares: quotas?.maxCpuShares?.toString() ?? "",
		maxMemoryMb: quotas?.maxMemoryMb?.toString() ?? "",
		runtimeLogRetentionDays: quotas?.runtimeLogRetentionDays?.toString() ?? "",
		runtimeLogMaxMbPerService: quotas?.runtimeLogMaxMbPerService?.toString() ?? "",
	});
	const {
		maxProjects,
		maxServices,
		maxCpuShares,
		maxMemoryMb,
		runtimeLogRetentionDays,
		runtimeLogMaxMbPerService,
	} = draft.value;

	const save = useSaveMutation(trpc.organization.updateSettings.mutationOptions(), {
		successMessage: "Quotas updated",
		invalidate: [trpc.organization.settings.queryKey()],
		onSuccess: draft.markSaved,
	});

	const onSave = () =>
		save.mutate({
			quotas: {
				maxProjects: parseLimit(maxProjects),
				maxServices: parseLimit(maxServices),
				maxCpuShares: parseLimit(maxCpuShares),
				maxMemoryMb: parseLimit(maxMemoryMb),
				runtimeLogRetentionDays: parseLimit(runtimeLogRetentionDays),
				runtimeLogMaxMbPerService: parseLimit(runtimeLogMaxMbPerService),
			},
		});

	useSaveBar(draft, { onSave, pending: save.isPending, disabled: !canManage });

	function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		onSave();
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

	const { usage, runtimeLogCeiling } = settingsQuery.data;
	const ceilingLabel = (value: number, unit: string) =>
		value === 0 ? "No instance limit" : `Instance limit: ${value} ${unit}`;

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
							onChange={(e) => draft.patch({ maxProjects: e.target.value })}
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
							onChange={(e) => draft.patch({ maxServices: e.target.value })}
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
							onChange={(e) => draft.patch({ maxCpuShares: e.target.value })}
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
							onChange={(e) => draft.patch({ maxMemoryMb: e.target.value })}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="runtime-log-days">Runtime log history (days)</Label>
						<Input
							id="runtime-log-days"
							type="number"
							min={0}
							placeholder={ceilingLabel(runtimeLogCeiling.retentionDays, "days")}
							value={runtimeLogRetentionDays}
							onChange={(e) => draft.patch({ runtimeLogRetentionDays: e.target.value })}
						/>
						<p className="text-xs text-muted-foreground">
							How long what each service printed is kept searchable. The instance limit is the
							ceiling; an organization can keep less, not more.
						</p>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="runtime-log-mb">Runtime log history per service (MB)</Label>
						<Input
							id="runtime-log-mb"
							type="number"
							min={0}
							placeholder={ceilingLabel(runtimeLogCeiling.maxMbPerService, "MB")}
							value={runtimeLogMaxMbPerService}
							onChange={(e) => draft.patch({ runtimeLogMaxMbPerService: e.target.value })}
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
