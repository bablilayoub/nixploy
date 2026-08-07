"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

function shortDigest(digest: string | null | undefined): string {
	if (!digest) return "—";
	const bare = digest.replace(/^sha256:/, "");
	return `${bare.slice(0, 12)}…`;
}

function formatWhen(iso: string | null | undefined): string {
	if (!iso) return "Never";
	try {
		return new Date(iso).toLocaleString();
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

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="grid gap-1.5">
						<CardTitle className="flex items-center gap-2">
							<ArrowUpCircle className="size-4" />
							Updates
						</CardTitle>
						<CardDescription>
							Check GitHub Container Registry for a newer Nixploy image and roll this host.
						</CardDescription>
					</div>
					{data?.updateInProgress ? (
						<Badge variant="secondary" className="gap-1.5">
							<Loader2 className="size-3 animate-spin" />
							Updating…
						</Badge>
					) : data?.updateAvailable ? (
						<Badge>Update available</Badge>
					) : data ? (
						<Badge variant="outline" className="gap-1.5">
							<CheckCircle2 className="size-3" />
							Up to date
						</Badge>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				{statusQuery.isPending ? (
					<div className="grid gap-4">
						<Skeleton className="h-16 w-full" />
						<Skeleton className="h-9 w-48" />
					</div>
				) : statusQuery.error && !data ? (
					<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-6 text-center">
						<p className="text-sm text-muted-foreground">{statusQuery.error.message}</p>
						<Button size="sm" variant="outline" onClick={() => statusQuery.refetch()}>
							Retry
						</Button>
					</div>
				) : data ? (
					<div className="grid gap-5">
						{data.updateInProgress && (
							<p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
								Applying the update — the dashboard restarts and reconnects automatically. This
								usually takes under a minute.
							</p>
						)}
						<div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-2">
							<div className="flex justify-between gap-4 sm:block">
								<p className="text-muted-foreground">Version</p>
								<p className="font-medium tabular-nums">{data.appVersion}</p>
							</div>
							<div className="flex justify-between gap-4 sm:block">
								<p className="text-muted-foreground">Tracked image</p>
								<p className="truncate font-mono text-xs">{data.image}</p>
							</div>
							<div className="flex justify-between gap-4 sm:block">
								<p className="text-muted-foreground">Running digest</p>
								<p className="font-mono text-xs">{shortDigest(data.currentDigest)}</p>
							</div>
							<div className="flex justify-between gap-4 sm:block">
								<p className="text-muted-foreground">Latest digest</p>
								<p className="font-mono text-xs">{shortDigest(data.latestDigest)}</p>
							</div>
							<div className="flex justify-between gap-4 sm:col-span-2 sm:block">
								<p className="text-muted-foreground">Last checked</p>
								<p>{formatWhen(data.lastCheckedAt)}</p>
							</div>
							{data.lastUpdateAt && (
								<div className="flex justify-between gap-4 sm:col-span-2 sm:block">
									<p className="text-muted-foreground">Last update</p>
									<p>{formatWhen(data.lastUpdateAt)}</p>
								</div>
							)}
							{data.lastError && (
								<p className="sm:col-span-2 text-xs text-warning">{data.lastError}</p>
							)}
						</div>

						<div className="grid gap-4">
							<div className="flex items-center justify-between gap-4">
								<div className="grid gap-0.5">
									<Label htmlFor="auto-check">Automatic checks</Label>
									<p className="text-xs text-muted-foreground">
										Look for a newer image on a schedule ({data.checkCron}).
									</p>
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
										When a newer image is found, pull it and restart Nixploy automatically.
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
						</div>

						<div className="flex flex-wrap gap-2">
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
								Check now
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
										) : (
											<ArrowUpCircle className="size-4" />
										)}
										{data.updateAvailable ? "Update now" : "Reinstall image"}
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
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
