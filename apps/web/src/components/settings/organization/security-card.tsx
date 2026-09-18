"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/settings-section";
import { useSaveBar } from "@/components/services/save-bar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useMounted } from "@/hooks/use-mounted";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { missingCapabilityHint } from "@/lib/capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

const DESCRIPTION =
	"Access requirements for every member of this organization. Owner or admin required to edit.";

export function SecurityCard() {
	const trpc = useTRPC();
	const settingsQuery = useQuery(trpc.organization.settings.queryOptions());
	// The dashboard layout (branding provider) starts this same query, so it
	// can already be resolved when this page segment hydrates — keep the
	// server-rendered skeleton until mount so both paints agree.
	const mounted = useMounted();
	const { can } = useCapabilities();
	const canManage = can("settings.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("settings.manage");

	const draft = useDraft(settingsQuery.data?.requireTwoFactor ?? false);
	const requireTwoFactor = draft.value;

	const save = useSaveMutation(trpc.organization.updateSettings.mutationOptions(), {
		successMessage: "Security settings updated",
		invalidate: [trpc.organization.settings.queryKey()],
		onSuccess: draft.markSaved,
	});

	const unchanged = requireTwoFactor === settingsQuery.data?.requireTwoFactor;
	const onSave = () => save.mutate({ requireTwoFactor });
	useSaveBar(draft, {
		onSave,
		pending: save.isPending,
		disabled: !canManage || unchanged,
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
						onCheckedChange={draft.set}
					/>
				</div>
				<RequireSsoRow canManage={canManage} manageHint={manageHint} />
				<div>
					<Button
						onClick={onSave}
						title={manageHint}
						disabled={!canManage || save.isPending || unchanged}
					>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save security settings
					</Button>
				</div>
			</div>
		</SettingsSection>
	);
}

/**
 * The SSO requirement.
 *
 * Separate from the 2FA switch and saved on toggle rather than through the
 * save bar, because it is the one setting in this card that can lock the
 * organization out of itself — `sso.requirement` says up front whether it may
 * be turned on at all, so the switch is disabled with the reason attached
 * instead of failing after someone hits Save.
 */
function RequireSsoRow({
	canManage,
	manageHint,
}: {
	canManage: boolean;
	manageHint: string | undefined;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const requirement = useQuery(trpc.sso.requirement.queryOptions());
	const setRequirement = useMutation(
		trpc.sso.setRequirement.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					result.requireSso
						? "Single sign-on is now required for this organization"
						: "Single sign-on is no longer required",
				);
				void queryClient.invalidateQueries({ queryKey: trpc.sso.requirement.queryKey() });
			},
			onError: (error) => toastError(error, "Could not change the SSO requirement"),
		}),
	);

	const data = requirement.data;
	const blockedReason =
		data && !data.requireSso && !data.lockout.allowed ? data.lockout.reason : null;
	const disabled =
		!canManage || requirement.isPending || setRequirement.isPending || Boolean(blockedReason);

	return (
		<div className="flex items-center justify-between rounded-md border p-3">
			<div className="flex flex-col gap-1 pe-4">
				<Label htmlFor="require-sso">Require single sign-on</Label>
				<p className="text-xs text-muted-foreground">
					Members who did not sign in through the identity provider are asked to. Instance admins
					stay exempt, so there is always a way back in.
				</p>
				{blockedReason ? (
					<p className="text-xs text-amber-600 dark:text-amber-400">{blockedReason}</p>
				) : null}
			</div>
			<Switch
				id="require-sso"
				checked={data?.requireSso ?? false}
				disabled={disabled}
				title={blockedReason ?? manageHint}
				onCheckedChange={(requireSso) => setRequirement.mutate({ requireSso })}
			/>
		</div>
	);
}
