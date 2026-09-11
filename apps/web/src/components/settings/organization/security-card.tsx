"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCapabilities } from "@/hooks/use-capabilities";
import { missingCapabilityHint } from "@/lib/capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

const DESCRIPTION =
	"Access requirements for every member of this organization. Owner or admin required to edit.";

export function SecurityCard() {
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

	const [requireTwoFactor, setRequireTwoFactor] = useState(false);

	useEffect(() => {
		if (!settingsQuery.data) return;
		setRequireTwoFactor(settingsQuery.data.requireTwoFactor);
	}, [settingsQuery.data]);

	const save = useMutation({
		...trpc.organization.updateSettings.mutationOptions(),
		onSuccess: async () => {
			toast.success("Security settings updated");
			await queryClient.invalidateQueries({ queryKey: trpc.organization.settings.queryKey() });
		},
		onError: (error) => toastError(error),
	});

	if (!mounted || settingsQuery.isPending) {
		return (
			<SettingsSection title="Security" description={DESCRIPTION}>
				<Skeleton className="h-16 w-full" />
			</SettingsSection>
		);
	}

	if (settingsQuery.isError) {
		return (
			<SettingsSection title="Security" description={DESCRIPTION}>
				<div className="flex flex-col items-center gap-2 py-8 text-center">
					<p className="text-sm font-medium">Could not load security settings</p>
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

	return (
		<SettingsSection title="Security" description={DESCRIPTION}>
			<div className="flex flex-col gap-4">
				<div className="flex items-center justify-between rounded-md border p-3">
					<div className="flex flex-col gap-1">
						<Label htmlFor="require-two-factor">Require two-factor authentication</Label>
						<p className="text-xs text-muted-foreground">
							Members without 2FA on their account are asked to set it up and cannot use org
							resources until they do.
						</p>
					</div>
					<Switch
						id="require-two-factor"
						checked={requireTwoFactor}
						disabled={!canManage}
						title={manageHint}
						onCheckedChange={setRequireTwoFactor}
					/>
				</div>
				<div>
					<Button
						onClick={() => save.mutate({ requireTwoFactor })}
						title={manageHint}
						disabled={
							!canManage ||
							save.isPending ||
							requireTwoFactor === settingsQuery.data.requireTwoFactor
						}
					>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save security settings
					</Button>
				</div>
			</div>
		</SettingsSection>
	);
}
