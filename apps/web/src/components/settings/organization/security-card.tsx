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
import { useTRPC } from "@/lib/trpc";

export function SecurityCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());

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
		onError: (error) => toast.error(error.message),
	});

	if (settingsQuery.isPending) {
		return (
			<SettingsSection
				title="Security"
				description="Access requirements for every member of this organization. Owner or admin required to edit."
			>
				<Skeleton className="h-16 w-full" />
			</SettingsSection>
		);
	}

	if (!settingsQuery.data) return null;

	return (
		<SettingsSection
			title="Security"
			description="Access requirements for every member of this organization. Owner or admin required to edit."
		>
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
						onCheckedChange={setRequireTwoFactor}
					/>
				</div>
				<div>
					<Button
						onClick={() => save.mutate({ requireTwoFactor })}
						disabled={save.isPending || requireTwoFactor === settingsQuery.data.requireTwoFactor}
					>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save security settings
					</Button>
				</div>
			</div>
		</SettingsSection>
	);
}
