"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

function formatWhen(iso: string | null | undefined): string {
	if (!iso) return "Never checked";
	try {
		return `Checked ${new Date(iso).toLocaleString()}`;
	} catch {
		return iso;
	}
}

/** Platform self-update: check GHCR digests, toggle auto-update, roll the service. */
export function UpdatesCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const statusQuery = useQuery({
		...trpc.updates.getStatus.queryOptions(),
		refetchInterval: (query) => (query.state.data?.updateInProgress ? 5_000 : 60_000),
	});

	const [autoCheck, setAutoCheck] = useState(true);
	const [autoUpdate, setAutoUpdate] = useState(false);

	useEffect(() => {
		const data = statusQuery.data;
		if (!data) return;
		setAutoCheck(data.autoCheckEnabled);
		setAutoUpdate(data.autoUpdateEnabled);
	}, [statusQuery.data]);

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.updates.getStatus.queryKey() });
	};

	const settingsMutation = useMutation(
		trpc.updates.updateSettings.mutationOptions({
			onSuccess: async () => {
				toast.success("Update settings saved");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const checkMutation = useMutation(
		trpc.updates.check.mutationOptions({
			onSuccess: async (result) => {
				if (result.error) {
					toast.error(result.error);
				} else if (result.updateAvailable) {
					toast.success("A new version is available");
				} else {
					toast.success("You're on the latest version");
				}
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const applyMutation = useMutation(
		trpc.updates.runUpdate.mutationOptions({
			onSuccess: async (result) => {
				if (result.started) {
					toast.success(result.message);
				} else {
					toast.message(result.message);
				}
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const data = statusQuery.data;
	const busy = settingsMutation.isPending || checkMutation.isPending || applyMutation.isPending;

	const statusBadge = data?.updateInProgress ? (
		<Badge variant="secondary" className="gap-1.5">
			<Loader2 className="size-3 animate-spin" />
			Updating…
		</Badge>
	) : data?.updateAvailable ? (
		<Badge>Update available</Badge>
	) : data ? (
		<Badge variant="outline">Up to date</Badge>
	) : null;

	return (
		<SettingsSection
			id="updates"
			title="Updates"
			description="Keep this Nixploy host on the latest image."
			actions={
				<div className="flex flex-wrap items-center gap-2">
					{statusBadge}
					{data ? (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={busy || data.updateInProgress}
								onClick={() => checkMutation.mutate()}
							>
								{checkMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								Check
							</Button>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										type="button"
										size="sm"
										disabled={busy || data.updateInProgress}
										variant={data.updateAvailable ? "default" : "outline"}
									>
										{applyMutation.isPending || data.updateInProgress ? (
											<Loader2 className="size-4 animate-spin" />
										) : null}
										{data.updateAvailable ? "Update" : "Reinstall"}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											{data.updateAvailable ? "Update Nixploy?" : "Reinstall Nixploy image?"}
										</AlertDialogTitle>
										<AlertDialogDescription>
											This pulls {data.image} and rolls the Swarm service. The dashboard will
											briefly disconnect while the new container starts. Your data, secrets and
											certificates are kept.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={(event) => {
												event.preventDefault();
												applyMutation.mutate();
											}}
										>
											{data.updateAvailable ? "Update now" : "Reinstall"}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</>
					) : null}
				</div>
			}
		>
			{statusQuery.isPending ? (
				<Skeleton className="h-16 w-full" />
			) : statusQuery.error && !data ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">{statusQuery.error.message}</p>
					<Button
						size="sm"
						variant="outline"
						className="w-fit"
						onClick={() => statusQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : data ? (
				<>
					{data.updateInProgress ? (
						<p className="text-sm text-muted-foreground">
							Applying update — the dashboard reconnects automatically.
						</p>
					) : (
						<p className="text-sm text-muted-foreground">
							<span className="font-medium text-foreground">v{data.appVersion}</span>
							<span className="mx-1.5 text-border">·</span>
							{formatWhen(data.lastCheckedAt)}
							{data.lastError ? (
								<>
									<span className="mx-1.5 text-border">·</span>
									<span className="text-warning">{data.lastError}</span>
								</>
							) : null}
						</p>
					)}

					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<Label htmlFor="auto-check">Automatic checks</Label>
							<p className="text-xs text-muted-foreground">Periodically look for a newer image.</p>
						</div>
						<Switch
							id="auto-check"
							checked={autoCheck}
							disabled={busy}
							onCheckedChange={(checked) => {
								setAutoCheck(checked);
								if (!checked) setAutoUpdate(false);
								settingsMutation.mutate({
									autoCheckEnabled: checked,
									...(checked ? {} : { autoUpdateEnabled: false }),
								});
							}}
						/>
					</div>
					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<Label htmlFor="auto-update">Automatic updates</Label>
							<p className="text-xs text-muted-foreground">
								Pull and restart when a newer image is found.
							</p>
						</div>
						<Switch
							id="auto-update"
							checked={autoUpdate}
							disabled={busy || !autoCheck}
							onCheckedChange={(checked) => {
								setAutoUpdate(checked);
								settingsMutation.mutate({ autoUpdateEnabled: checked });
							}}
						/>
					</div>
				</>
			) : null}
		</SettingsSection>
	);
}
