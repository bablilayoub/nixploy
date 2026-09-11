"use client";

import { yaml } from "@codemirror/lang-yaml";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	FileCode2,
	Loader2,
	RefreshCw,
	ShieldAlert,
	Trash2,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AcmeDnsCard } from "@/components/settings/server/acme-dns-card";
import { AiSettingsCard } from "@/components/settings/server/ai-settings-card";
import { HostMonitoringBody } from "@/components/settings/server/host-monitoring-card";
import { UpdatesCard } from "@/components/settings/server/updates-card";
import { UsersCard } from "@/components/settings/server/users-card";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
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
import { CodeEditor } from "@/components/ui/code-editor";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

function isForbidden(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"data" in error &&
		(error as { data?: { code?: string } }).data?.code === "FORBIDDEN"
	);
}

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

interface DnsCheckResult {
	domain: string;
	valid: boolean;
	resolvedIps: string[];
	serverIp: string | null;
	matches: boolean;
}

/**
 * Configure a domain for the Nixploy dashboard itself: DNS preflight,
 * Traefik router with Let's Encrypt, and a link once live.
 */
function DashboardDomainFields({
	savedDomain,
	letsEncryptEmail,
	isLoading,
	onSave,
	isSaving,
}: {
	savedDomain: string | null;
	letsEncryptEmail: string | null;
	isLoading: boolean;
	onSave: (domain: string | null) => void;
	isSaving: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [domain, setDomain] = useState("");
	const [dnsResult, setDnsResult] = useState<DnsCheckResult | null>(null);
	const [checking, setChecking] = useState(false);

	useEffect(() => {
		setDomain(savedDomain ?? "");
		setDnsResult(null);
	}, [savedDomain]);

	const checkDns = async () => {
		const value = domain.trim();
		if (!value) return;
		setChecking(true);
		setDnsResult(null);
		try {
			const result = await queryClient.fetchQuery(
				trpc.webServer.checkDashboardDomain.queryOptions({ domain: value }),
			);
			setDnsResult(result);
		} catch (error) {
			toastError(error, "DNS check failed");
		} finally {
			setChecking(false);
		}
	};

	const trimmed = domain.trim();
	const dirty = trimmed !== (savedDomain ?? "");

	if (isLoading) {
		return (
			<div className="grid gap-4">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-40" />
			</div>
		);
	}

	return (
		<div className="grid gap-3">
			<p className="text-xs text-muted-foreground">
				Point a DNS <span className="font-mono">A</span> record at this server, set the Let&apos;s
				Encrypt email below, then save.
			</p>
			<div className="flex max-w-xl flex-wrap items-end gap-2">
				<div className="grid min-w-64 flex-1 gap-2">
					<Label htmlFor="dashboard-domain">Domain</Label>
					<Input
						id="dashboard-domain"
						placeholder="panel.nixploy.com"
						value={domain}
						onChange={(event) => {
							setDomain(event.target.value);
							setDnsResult(null);
						}}
					/>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-9"
					onClick={checkDns}
					disabled={checking || !trimmed}
				>
					{checking && <Loader2 className="size-4 animate-spin" />}
					Check DNS
				</Button>
				<Button
					type="button"
					size="sm"
					className="h-9"
					disabled={isSaving || !dirty}
					onClick={() => onSave(trimmed || null)}
				>
					{isSaving && <Loader2 className="size-4 animate-spin" />}
					{trimmed ? "Save domain" : "Remove"}
				</Button>
			</div>

			{dnsResult && (
				<div
					className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
						dnsResult.matches
							? "border-success/50 bg-success/10 text-success"
							: "border-warning/50 bg-warning/10 text-warning"
					}`}
				>
					{dnsResult.matches ? (
						<CheckCircle2 className="mt-0.5 size-4 shrink-0" />
					) : (
						<XCircle className="mt-0.5 size-4 shrink-0" />
					)}
					<div className="grid gap-0.5">
						{!dnsResult.valid ? (
							<p>Not a valid domain name.</p>
						) : dnsResult.matches ? (
							<p>
								<span className="font-mono">{dnsResult.domain}</span> points at this server (
								{dnsResult.serverIp}).
							</p>
						) : dnsResult.resolvedIps.length === 0 ? (
							<p>
								<span className="font-mono">{dnsResult.domain}</span> does not resolve yet — you can
								save anyway.
							</p>
						) : (
							<p>
								<span className="font-mono">{dnsResult.domain}</span> resolves to{" "}
								{dnsResult.resolvedIps.join(", ")}
								{dnsResult.serverIp ? ` (server is ${dnsResult.serverIp})` : ""}.
							</p>
						)}
					</div>
				</div>
			)}

			{savedDomain && (
				<a
					href={`https://${savedDomain}`}
					target="_blank"
					rel="noreferrer"
					className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
				>
					https://{savedDomain}
					<ExternalLink className="size-3.5" />
				</a>
			)}

			{trimmed && !letsEncryptEmail && (
				<p className="text-xs text-warning">Set the Let&apos;s Encrypt email below first.</p>
			)}
		</div>
	);
}

export function ServerSettingsView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const settingsQuery = useQuery(trpc.webServer.getSettings.queryOptions());
	const traefikQuery = useQuery(trpc.webServer.getTraefikConfig.queryOptions());

	const [letsEncryptEmail, setLetsEncryptEmail] = useState("");
	const [traefikDashboardEnabled, setTraefikDashboardEnabled] = useState(false);
	const [cleanupCronEnabled, setCleanupCronEnabled] = useState(false);
	const [cleanupCronExpression, setCleanupCronExpression] = useState("");
	const [cpuAlertPercent, setCpuAlertPercent] = useState("");
	const [memoryAlertPercent, setMemoryAlertPercent] = useState("");

	useEffect(() => {
		const settings = settingsQuery.data;
		if (settings === undefined) return;
		setLetsEncryptEmail(settings?.letsEncryptEmail ?? "");
		setTraefikDashboardEnabled(settings?.traefikDashboardEnabled ?? false);
		setCleanupCronEnabled(settings?.cleanupCronEnabled ?? false);
		setCleanupCronExpression(settings?.cleanupCronExpression ?? "");
		setCpuAlertPercent(settings?.cpuAlertPercent ? String(settings.cpuAlertPercent) : "");
		setMemoryAlertPercent(settings?.memoryAlertPercent ? String(settings.memoryAlertPercent) : "");
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
						? "Settings saved — routing updated (no restart needed)"
						: "Settings saved",
				);
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	const restartMutation = useMutation(
		trpc.webServer.restartTraefik.mutationOptions({
			onSuccess: () => toast.success("Traefik restart triggered"),
			onError: (error) => toastError(error),
		}),
	);

	const cleanupMutation = useMutation(
		trpc.webServer.dockerCleanupNow.mutationOptions({
			onSuccess: () => toast.success("Docker cleanup complete"),
			onError: (error) => toastError(error),
		}),
	);

	const saveAccess = () => {
		updateMutation.mutate({
			letsEncryptEmail: letsEncryptEmail.trim() || null,
		});
	};

	const saveProxy = () => {
		updateMutation.mutate({
			traefikDashboardEnabled,
		});
	};

	const saveHealth = () => {
		// The API accepts 1–100; empty or 0 means "off" (null). Anything above
		// 100 is a typo we surface instead of bouncing a raw zod error.
		const parseThreshold = (raw: string): number | null | "invalid" => {
			const trimmed = raw.trim();
			if (!trimmed) return null;
			const value = Number.parseInt(trimmed, 10);
			if (!Number.isFinite(value) || value <= 0) return null;
			return value > 100 ? "invalid" : value;
		};
		const cpuAlert = parseThreshold(cpuAlertPercent);
		const memoryAlert = parseThreshold(memoryAlertPercent);
		if (cpuAlert === "invalid" || memoryAlert === "invalid") {
			toast.error("Alert thresholds must be between 1 and 100 percent");
			return;
		}
		updateMutation.mutate({
			cpuAlertPercent: cpuAlert,
			memoryAlertPercent: memoryAlert,
		});
	};

	const saveMaintenance = () => {
		updateMutation.mutate({
			cleanupCronEnabled,
			cleanupCronExpression: cleanupCronExpression.trim() || null,
		});
	};

	if (settingsQuery.error || traefikQuery.error) {
		const forbidden = isForbidden(settingsQuery.error) || isForbidden(traefikQuery.error);
		return (
			<div className="flex flex-col gap-8">
				<PageHeader
					title="Platform"
					description="Domain, Traefik, host health, maintenance, and updates."
				/>
				<SettingsSection title="Platform settings">
					<div className="flex flex-col items-center gap-2 py-10 text-center">
						<ShieldAlert className="size-8 text-muted-foreground" />
						<p className="text-sm font-medium">
							{forbidden ? "Insufficient permissions" : "Failed to load server settings"}
						</p>
						<p className="text-sm text-muted-foreground">
							{forbidden
								? "Platform settings are only available to the instance admin."
								: (settingsQuery.error?.message ?? traefikQuery.error?.message)}
						</p>
					</div>
				</SettingsSection>
			</div>
		);
	}

	const traefikConfig = traefikQuery.data;
	const savedLetsEncrypt = settingsQuery.data?.letsEncryptEmail ?? null;

	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				title="Platform"
				description="Domain, Traefik, host health, maintenance, and updates."
			/>

			<SettingsStack>
				{/* Access: domain + Let's Encrypt */}
				<SettingsSection
					id="access"
					title="Access"
					description="Serve this panel from your own domain with automatic HTTPS."
					actions={
						<Button
							type="button"
							size="sm"
							disabled={updateMutation.isPending || settingsQuery.isPending}
							onClick={saveAccess}
						>
							{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Save email
						</Button>
					}
				>
					{settingsQuery.isPending ? (
						<div className="grid gap-4">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : (
						<>
							<DashboardDomainFields
								savedDomain={settingsQuery.data?.host ?? null}
								letsEncryptEmail={savedLetsEncrypt}
								isLoading={false}
								isSaving={updateMutation.isPending}
								onSave={(host) => updateMutation.mutate({ host })}
							/>
							<div className="grid gap-2">
								<Label htmlFor="letsencrypt-email">Let&apos;s Encrypt email</Label>
								<Input
									id="letsencrypt-email"
									type="email"
									placeholder="admin@example.com"
									value={letsEncryptEmail}
									onChange={(event) => setLetsEncryptEmail(event.target.value)}
								/>
							</div>
						</>
					)}
				</SettingsSection>

				{/* Wildcard certificates: DNS-01 provider + credentials */}
				<AcmeDnsCard />

				{/* Proxy: Traefik dashboard + collapsed config + restart */}
				<SettingsSection
					id="proxy"
					title="Proxy"
					description="Traefik reverse proxy for the Nixploy host."
					actions={
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								size="sm"
								disabled={updateMutation.isPending || settingsQuery.isPending}
								onClick={saveProxy}
							>
								{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
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
										Restart
									</Button>
								}
							/>
						</div>
					}
				>
					{settingsQuery.isPending ? (
						<Skeleton className="h-9 w-full" />
					) : (
						<div className="flex items-center justify-between gap-4">
							<div className="grid gap-0.5">
								<Label htmlFor="traefik-dashboard">Traefik dashboard</Label>
								<p className="text-xs text-muted-foreground">Expose the dashboard and API.</p>
							</div>
							<Switch
								id="traefik-dashboard"
								checked={traefikDashboardEnabled}
								onCheckedChange={setTraefikDashboardEnabled}
							/>
						</div>
					)}

					<details className="group">
						<summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
							<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
							Advanced: Traefik config
						</summary>
						<div className="mt-3 space-y-4">
							<p className="text-sm text-muted-foreground">
								Nixploy owns these files — edits are overwritten on the next deploy.{" "}
								<HelpLink slug="domains" />
							</p>
							{traefikQuery.isPending ? (
								<Skeleton className="h-64 w-full" />
							) : (
								<>
									{traefikConfig?.staticConfig ? (
										<CodeEditor
											value={traefikConfig.staticConfig}
											extensions={[yaml()]}
											readOnly
											maxHeight="20rem"
											basicSetup={{ lineNumbers: true, foldGutter: true }}
											lockMessage="Traefik static config is read-only. Unlock to view the full file."
										/>
									) : (
										<p className="text-sm text-muted-foreground">
											No traefik.yml on this host yet.
										</p>
									)}
									{traefikConfig && traefikConfig.dynamicConfigs.length > 0 ? (
										<ul className="text-sm text-muted-foreground">
											{traefikConfig.dynamicConfigs.map((file) => (
												<li key={file} className="flex items-center gap-2 py-1">
													<FileCode2 className="size-3.5 shrink-0" />
													<code className="font-mono text-xs">{file}</code>
												</li>
											))}
										</ul>
									) : null}
								</>
							)}
						</div>
					</details>
				</SettingsSection>

				{/* Host health: meters + alert thresholds */}
				<SettingsSection
					id="health"
					title="Host health"
					description="Live host metrics and alert thresholds for subscribed channels."
					actions={
						<Button
							type="button"
							size="sm"
							disabled={updateMutation.isPending || settingsQuery.isPending}
							onClick={saveHealth}
						>
							{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Save thresholds
						</Button>
					}
				>
					<HostMonitoringBody />
					{settingsQuery.isPending ? (
						<Skeleton className="h-16 w-full" />
					) : (
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="cpu-alert">CPU alert %</Label>
								<Input
									id="cpu-alert"
									type="number"
									min={1}
									max={100}
									inputMode="numeric"
									placeholder="Empty = off"
									value={cpuAlertPercent}
									onChange={(event) => setCpuAlertPercent(event.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="memory-alert">Memory alert %</Label>
								<Input
									id="memory-alert"
									type="number"
									min={1}
									max={100}
									inputMode="numeric"
									placeholder="Empty = off"
									value={memoryAlertPercent}
									onChange={(event) => setMemoryAlertPercent(event.target.value)}
								/>
							</div>
						</div>
					)}
				</SettingsSection>

				{/* Maintenance: cleanup cron + run now + schedules link */}
				<SettingsSection
					id="maintenance"
					title="Maintenance"
					description="Prune unused Docker images and build cache."
					actions={
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								size="sm"
								disabled={updateMutation.isPending || settingsQuery.isPending}
								onClick={saveMaintenance}
							>
								{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
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
					}
				>
					{settingsQuery.isPending ? (
						<Skeleton className="h-9 w-full" />
					) : (
						<>
							<div className="flex items-center justify-between gap-4">
								<div className="grid gap-0.5">
									<Label htmlFor="cleanup-cron">Scheduled cleanup</Label>
									<p className="text-xs text-muted-foreground">
										Prune unused images on a cron schedule.
									</p>
								</div>
								<Switch
									id="cleanup-cron"
									checked={cleanupCronEnabled}
									onCheckedChange={setCleanupCronEnabled}
								/>
							</div>
							{cleanupCronEnabled && (
								<div className="grid gap-2">
									<Label htmlFor="cleanup-cron-expression">Cron</Label>
									<Input
										id="cleanup-cron-expression"
										placeholder="0 3 * * *"
										value={cleanupCronExpression}
										onChange={(event) => setCleanupCronExpression(event.target.value)}
										className="font-mono"
									/>
								</div>
							)}
							<p className="text-sm text-muted-foreground">
								Custom host jobs →{" "}
								<Link
									href="/dashboard/schedules"
									className="font-medium text-foreground underline-offset-4 hover:underline"
								>
									Schedules
								</Link>
							</p>
						</>
					)}
				</SettingsSection>

				<UpdatesCard />
				<AiSettingsCard />
				<UsersCard />
			</SettingsStack>
		</div>
	);
}
