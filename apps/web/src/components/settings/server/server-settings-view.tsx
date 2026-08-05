"use client";

import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2, Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HostMonitoringCard } from "@/components/settings/server/host-monitoring-card";
import { PageHeader } from "@/components/shell";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";

function isForbidden(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"data" in error &&
		(error as { data?: { code?: string } }).data?.code === "FORBIDDEN"
	);
}

interface SettingsForm {
	letsEncryptEmail: string;
	traefikDashboardEnabled: boolean;
	cleanupCronEnabled: boolean;
	cleanupCronExpression: string;
	cpuAlertPercent: string;
	memoryAlertPercent: string;
}

const emptyForm: SettingsForm = {
	letsEncryptEmail: "",
	traefikDashboardEnabled: false,
	cleanupCronEnabled: false,
	cleanupCronExpression: "",
	cpuAlertPercent: "",
	memoryAlertPercent: "",
};

function ConfirmActionDialog({
	title,
	description,
	actionLabel,
	isPending,
	onConfirm,
	trigger,
}: {
	title: string;
	description: string;
	actionLabel: string;
	isPending: boolean;
	onConfirm: () => void;
	trigger: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={isPending}
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
							setOpen(false);
						}}
					>
						{isPending && <Loader2 className="size-4 animate-spin" />}
						{actionLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function ServerSettingsView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const settingsQuery = useQuery(trpc.webServer.getSettings.queryOptions());
	const traefikQuery = useQuery(trpc.webServer.getTraefikConfig.queryOptions());

	const [form, setForm] = useState<SettingsForm>(emptyForm);

	// Sync the form once settings load (and after each refetch).
	useEffect(() => {
		const settings = settingsQuery.data;
		if (settings === undefined) return;
		setForm({
			letsEncryptEmail: settings?.letsEncryptEmail ?? "",
			traefikDashboardEnabled: settings?.traefikDashboardEnabled ?? false,
			cleanupCronEnabled: settings?.cleanupCronEnabled ?? false,
			cleanupCronExpression: settings?.cleanupCronExpression ?? "",
			cpuAlertPercent: settings?.cpuAlertPercent ? String(settings.cpuAlertPercent) : "",
			memoryAlertPercent: settings?.memoryAlertPercent ? String(settings.memoryAlertPercent) : "",
		});
	}, [settingsQuery.data]);

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.webServer.getSettings.queryKey() });
		await queryClient.invalidateQueries({ queryKey: trpc.webServer.getTraefikConfig.queryKey() });
	};

	const updateMutation = useMutation(
		trpc.webServer.updateSettings.mutationOptions({
			onSuccess: async (result) => {
				toast.success(
					result.traefikConfigRewritten
						? "Settings saved — Traefik config updated, restart to apply"
						: "Settings saved",
				);
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const restartMutation = useMutation(
		trpc.webServer.restartTraefik.mutationOptions({
			onSuccess: () => toast.success("Traefik restart triggered"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const cleanupMutation = useMutation(
		trpc.webServer.dockerCleanupNow.mutationOptions({
			onSuccess: () => toast.success("Docker cleanup complete"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		const cpuAlert = Number.parseInt(form.cpuAlertPercent, 10);
		const memoryAlert = Number.parseInt(form.memoryAlertPercent, 10);
		updateMutation.mutate({
			letsEncryptEmail: form.letsEncryptEmail.trim() || null,
			traefikDashboardEnabled: form.traefikDashboardEnabled,
			cleanupCronEnabled: form.cleanupCronEnabled,
			cleanupCronExpression: form.cleanupCronExpression.trim() || null,
			cpuAlertPercent: Number.isFinite(cpuAlert) ? cpuAlert : null,
			memoryAlertPercent: Number.isFinite(memoryAlert) ? memoryAlert : null,
		});
	};

	if (settingsQuery.error || traefikQuery.error) {
		const forbidden = isForbidden(settingsQuery.error) || isForbidden(traefikQuery.error);
		return (
			<div className="flex flex-col gap-6">
				<PageHeader
					title="Server"
					description="Platform web server, TLS and maintenance settings."
				/>
				<Card>
					<CardContent className="flex flex-col items-center gap-2 py-10 text-center">
						<ShieldAlert className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">
							{forbidden ? "Insufficient permissions" : "Failed to load server settings"}
						</p>
						<p className="text-sm text-muted-foreground">
							{forbidden
								? "Web server settings are only available to organization owners and admins."
								: (settingsQuery.error?.message ?? traefikQuery.error?.message)}
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const traefikConfig = traefikQuery.data;

	return (
		<div className="flex flex-col gap-6">
			<PageHeader title="Server" description="Platform web server, TLS and maintenance settings." />

			<HostMonitoringCard />

			<Card>
				<CardHeader>
					<CardTitle>Web server</CardTitle>
					<CardDescription>
						Global Traefik and Let&apos;s Encrypt settings for the Nixploy host.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{settingsQuery.isPending ? (
						<div className="grid max-w-md gap-4">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : (
						<form onSubmit={onSubmit} className="grid max-w-md gap-5">
							<div className="grid gap-2">
								<Label htmlFor="letsencrypt-email">Let&apos;s Encrypt email</Label>
								<Input
									id="letsencrypt-email"
									type="email"
									placeholder="admin@example.com"
									value={form.letsEncryptEmail}
									onChange={(event) => setForm({ ...form, letsEncryptEmail: event.target.value })}
								/>
								<p className="text-xs text-muted-foreground">
									ACME account email used for automatic TLS certificates. Changing it rewrites the
									static Traefik config; restart Traefik to apply.
								</p>
							</div>
							<div className="flex items-center justify-between gap-4">
								<div className="grid gap-0.5">
									<Label htmlFor="traefik-dashboard">Traefik dashboard</Label>
									<p className="text-xs text-muted-foreground">
										Expose the Traefik dashboard and API.
									</p>
								</div>
								<Switch
									id="traefik-dashboard"
									checked={form.traefikDashboardEnabled}
									onCheckedChange={(checked) =>
										setForm({ ...form, traefikDashboardEnabled: checked })
									}
								/>
							</div>
							<div className="flex items-center justify-between gap-4">
								<div className="grid gap-0.5">
									<Label htmlFor="cleanup-cron">Scheduled Docker cleanup</Label>
									<p className="text-xs text-muted-foreground">
										Prune unused images and build cache on a cron schedule.
									</p>
								</div>
								<Switch
									id="cleanup-cron"
									checked={form.cleanupCronEnabled}
									onCheckedChange={(checked) => setForm({ ...form, cleanupCronEnabled: checked })}
								/>
							</div>
							{form.cleanupCronEnabled && (
								<div className="grid gap-2">
									<Label htmlFor="cleanup-cron-expression">Cron expression</Label>
									<Input
										id="cleanup-cron-expression"
										placeholder="0 3 * * *"
										value={form.cleanupCronExpression}
										onChange={(event) =>
											setForm({ ...form, cleanupCronExpression: event.target.value })
										}
										className="font-mono"
									/>
								</div>
							)}
							<div className="grid gap-3 rounded-lg border border-border p-3">
								<div className="grid gap-1">
									<Label>Alert thresholds</Label>
									<p className="text-xs text-muted-foreground">
										Notify subscribed channels (serverThreshold event) when a service averages above
										these for ~2.5 minutes. Empty = disabled.
									</p>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									<div className="grid gap-2">
										<Label htmlFor="cpu-alert">CPU %</Label>
										<Input
											id="cpu-alert"
											inputMode="numeric"
											placeholder="e.g. 90"
											value={form.cpuAlertPercent}
											onChange={(event) =>
												setForm({ ...form, cpuAlertPercent: event.target.value })
											}
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="memory-alert">Memory %</Label>
										<Input
											id="memory-alert"
											inputMode="numeric"
											placeholder="e.g. 85"
											value={form.memoryAlertPercent}
											onChange={(event) =>
												setForm({ ...form, memoryAlertPercent: event.target.value })
											}
										/>
									</div>
								</div>
							</div>
							<div>
								<Button type="submit" size="sm" disabled={updateMutation.isPending}>
									{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
									Save changes
								</Button>
							</div>
						</form>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Traefik configuration</CardTitle>
					<CardDescription>
						The static traefik.yml on the host, plus generated dynamic configs.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					{traefikQuery.isPending ? (
						<Skeleton className="h-64 w-full" />
					) : (
						<>
							{traefikConfig?.staticConfig ? (
								<div className="overflow-hidden rounded-lg border border-border [&_.cm-editor]:bg-transparent [&_.cm-editor]:text-[13px] [&_.cm-gutters]:bg-transparent">
									<CodeMirror
										value={traefikConfig.staticConfig}
										extensions={[yaml()]}
										readOnly
										editable={false}
										maxHeight="24rem"
										basicSetup={{ lineNumbers: true, foldGutter: true }}
									/>
								</div>
							) : (
								<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
									<FileCode2 className="size-8 text-muted-foreground" />
									<p className="text-sm text-muted-foreground">
										No traefik.yml found on this host yet. It is created when Traefik is set up.
									</p>
								</div>
							)}
							<div className="grid gap-2">
								<p className="text-sm font-medium">Dynamic configs</p>
								{traefikConfig && traefikConfig.dynamicConfigs.length > 0 ? (
									<ul className="divide-y divide-border rounded-md border border-border">
										{traefikConfig.dynamicConfigs.map((file) => (
											<li
												key={file}
												className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
											>
												<FileCode2 className="size-4 shrink-0" />
												<code className="font-mono text-xs">{file}</code>
											</li>
										))}
									</ul>
								) : (
									<p className="text-sm text-muted-foreground">No dynamic config files yet.</p>
								)}
							</div>
						</>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Maintenance</CardTitle>
					<CardDescription>Operational actions for the Nixploy host.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<p className="text-sm font-medium">Restart Traefik</p>
							<p className="text-xs text-muted-foreground">
								Force-restart the global proxy to pick up static config changes.
							</p>
						</div>
						<ConfirmActionDialog
							title="Restart Traefik"
							description="This force-updates the Traefik swarm service. Active connections may be briefly interrupted."
							actionLabel="Restart"
							isPending={restartMutation.isPending}
							onConfirm={() => restartMutation.mutate()}
							trigger={
								<Button variant="outline" size="sm" disabled={restartMutation.isPending}>
									{restartMutation.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<RefreshCw className="size-4" />
									)}
									Restart Traefik
								</Button>
							}
						/>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<p className="text-sm font-medium">Docker cleanup</p>
							<p className="text-xs text-muted-foreground">
								Prune unused images and build cache on the host now.
							</p>
						</div>
						<ConfirmActionDialog
							title="Run Docker cleanup"
							description="Unused Docker images and build cache will be pruned on the Nixploy host. This cannot be undone."
							actionLabel="Run cleanup"
							isPending={cleanupMutation.isPending}
							onConfirm={() => cleanupMutation.mutate()}
							trigger={
								<Button variant="outline" size="sm" disabled={cleanupMutation.isPending}>
									{cleanupMutation.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Trash2 className="size-4" />
									)}
									Cleanup now
								</Button>
							}
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
