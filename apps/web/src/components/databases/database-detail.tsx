"use client";

import {
	classifyVersionChange,
	DATABASE_VERSIONS,
	imageForVersion,
	versionFromImage,
} from "@nixploy/server/modules/databases/versions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Eye, EyeOff, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { BackupsPanel } from "@/components/backups/backups-panel";
import {
	type ConnectionUrls,
	DATABASE_TYPES,
	type DatabaseIdInput,
	type DatabaseRouterFacade,
	type DatabaseRow,
	type DatabaseType,
	databaseIdInput,
	type ServiceStatus,
} from "@/components/databases/database-types";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { CopyButton } from "@/components/services/copy-button";
import { DangerZone } from "@/components/services/danger-zone";
import { EnvEditor } from "@/components/services/env-editor";
import { LogViewer } from "@/components/services/log-viewer";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { SaveBarTabsContent, useSaveBar } from "@/components/services/save-bar";
import { ServiceActionsCard } from "@/components/services/service-actions-card";
import { type ServiceActions, ServicePageHeader } from "@/components/services/service-page-header";
import { ServiceTerminal } from "@/components/services/service-terminal";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useLiveEventsConnected } from "@/hooks/use-live-events";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { SERVICE_TAB_ALIASES, useSyncedTab } from "@/hooks/use-synced-tab";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

interface DatabaseDetailProps {
	type: DatabaseType;
	/** Service id (postgresId / mysqlId / ... depending on `type`). */
	id: string;
	projectId: string;
}

/** Sub-tab → its top-level tab, so ?tab=logs deep-links into Runtime. */
const SUB_TAB_PARENT: Record<string, string> = {
	logs: "runtime",
	monitoring: "runtime",
	terminal: "runtime",
};

function RevealButton({
	revealed,
	onToggle,
	what = "password",
}: {
	revealed: boolean;
	onToggle: () => void;
	what?: string;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className="size-7 shrink-0"
			aria-label={revealed ? `Hide ${what}` : `Reveal ${what}`}
			aria-pressed={revealed}
			onClick={onToggle}
		>
			{revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
		</Button>
	);
}

function SecretField({ label, value }: { label: string; value: string }) {
	const [revealed, setRevealed] = useState(false);
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<div className="flex items-center gap-1">
				<Input readOnly value={revealed ? value : "••••••••••••"} className="font-mono" />
				<RevealButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
				<CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
			</div>
		</div>
	);
}

const URL_PASSWORD = /^([a-z][a-z0-9+.-]*:\/\/[^/?#@]*?:)([^@/?#]+)(@)/i;

/** `postgres://user:•••@host/db` — the credential stays out of screenshots and shoulder-surfing. */
function maskUrlPassword(url: string): string {
	return url.replace(URL_PASSWORD, "$1••••••••$3");
}

/** Connection URL with the password masked by default, a reveal toggle and copy (copies the real URL). */
function ConnectionUrlField({ url }: { url: string }) {
	const [revealed, setRevealed] = useState(false);
	const masked = maskUrlPassword(url);
	const hasPassword = masked !== url;
	return (
		<div className="flex items-center gap-1">
			<Input
				readOnly
				value={revealed || !hasPassword ? url : masked}
				className="font-mono text-xs"
			/>
			{hasPassword && <RevealButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />}
			<CopyButton value={url} label="Copy connection URL" />
		</div>
	);
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<div className="flex items-center gap-1">
				<Input readOnly value={value} className="font-mono" />
				<CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
			</div>
		</div>
	);
}

export function DatabaseDetail({ type, id, projectId }: DatabaseDetailProps) {
	const cfg = DATABASE_TYPES[type];
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const { can } = useCapabilities();
	// Database `start` deploys the swarm service (service.deploy); stop/reload
	// are runtime actions (service.runtime).
	const canDeploy = can("service.deploy");
	const canRuntime = can("service.runtime");
	const deployHint = canDeploy ? undefined : capabilityHint("service.deploy");
	const runtimeHint = canRuntime ? undefined : capabilityHint("service.runtime");

	const ns = useMemo(() => trpc[type] as unknown as DatabaseRouterFacade, [trpc, type]);
	const idInput = useMemo(() => databaseIdInput(type, id), [type, id]);

	const rowQuery = useQuery(ns.one.queryOptions(idInput));
	const db = rowQuery.data as DatabaseRow | undefined;

	// Pushed on `service-status` frames; poll only while the socket is down.
	const live = useLiveEventsConnected();
	const statusQuery = useQuery(
		ns.getStatus.queryOptions(idInput, { refetchInterval: live ? false : 30_000, retry: false }),
	);
	const status = ((statusQuery.data as ServiceStatus | undefined) ??
		db?.status ??
		"idle") as ServiceStatus;

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ns.one.queryKey(idInput) });
		queryClient.invalidateQueries({ queryKey: ns.getStatus.queryKey(idInput) });
		// The project services table reads name/status from `<engine>.all`.
		queryClient.invalidateQueries({ queryKey: ns.all.pathKey() });
	};

	const onError = (error: { message?: string }) => toastError(error, "Something went wrong");

	const startMutation = useMutation(
		ns.start.mutationOptions({
			onSuccess: () => {
				toast.success(`${cfg.label} started`);
				invalidate();
			},
			onError,
		}),
	);
	const stopMutation = useMutation(
		ns.stop.mutationOptions({
			onSuccess: () => {
				toast.success(`${cfg.label} stopped`);
				setConfirmStop(false);
				invalidate();
			},
			onError,
		}),
	);
	const reloadMutation = useMutation(
		ns.reload.mutationOptions({
			onSuccess: () => {
				toast.success(`${cfg.label} reloaded`);
				invalidate();
			},
			onError,
		}),
	);
	const removeMutation = useMutation(
		ns.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`${cfg.label} deleted`);
				// Drop the row from the project services list (30s staleTime would
				// otherwise keep showing it) and the environment counts.
				queryClient.invalidateQueries({ queryKey: ns.all.pathKey() });
				queryClient.invalidateQueries({
					queryKey: trpc.environment.byProject.queryKey({ projectId }),
				});
				queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() });
				router.push(`/dashboard/projects/${projectId}`);
			},
			onError,
		}),
	);

	const actionPending =
		startMutation.isPending || stopMutation.isPending || reloadMutation.isPending;
	const [confirmStop, setConfirmStop] = useState(false);
	const isRunning = status === "running" || status === "done";
	// CTA for the runtime empty states — database `start` deploys the service.
	const runtimeAction = (
		<DisabledHint hint={deployHint}>
			<Button
				size="sm"
				disabled={actionPending || !canDeploy}
				onClick={() => startMutation.mutate(idInput)}
			>
				{startMutation.isPending ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Play className="size-4" />
				)}
				Start
			</Button>
		</DisabledHint>
	);

	// Unified service tab order (UX audit F8), with the database-only
	// "Connection" tab right after General.
	const topTabs = [
		"general",
		"connection",
		"runtime",
		"environment",
		...(cfg.supportsBackups ? ["backups"] : []),
		"settings",
	];
	const [tab, selectTab] = useSyncedTab(
		"general",
		(value) => topTabs.includes(value) || value in SUB_TAB_PARENT,
		{ aliases: SERVICE_TAB_ALIASES },
	);
	const topTab = topTabs.includes(tab) ? tab : (SUB_TAB_PARENT[tab] ?? "general");
	const runtimeTab = SUB_TAB_PARENT[tab] === "runtime" ? tab : "logs";

	if (rowQuery.isLoading) {
		return (
			<div className="flex flex-col gap-6">
				<div className="flex items-center gap-3">
					<Skeleton className="size-10 rounded-lg" />
					<div className="space-y-2">
						<Skeleton className="h-5 w-48" />
						<Skeleton className="h-4 w-32" />
					</div>
				</div>
				<Skeleton className="h-9 w-full max-w-xl" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (rowQuery.isError || !db) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
				<AlertTriangle className="size-8 text-muted-foreground" />
				<h2 className="text-lg font-semibold">{cfg.label} not found</h2>
				<p className="text-sm text-muted-foreground">
					{rowQuery.error?.message ?? "This database does not exist or you don't have access."}
				</p>
				<div className="flex gap-2">
					{rowQuery.isError && (
						<Button variant="outline" onClick={() => rowQuery.refetch()}>
							Retry
						</Button>
					)}
					<Button variant="outline" onClick={() => router.push(`/dashboard/projects/${projectId}`)}>
						Back to project
					</Button>
				</div>
			</div>
		);
	}

	const serviceActions: ServiceActions = [
		isRunning
			? {
					key: "stop",
					label: "Stop",
					icon: Square,
					primary: true,
					variant: "outline" as const,
					onClick: () => setConfirmStop(true),
					pending: stopMutation.isPending,
					disabled: actionPending || !canRuntime,
					hint: runtimeHint,
				}
			: {
					key: "start",
					label: "Start",
					icon: Play,
					primary: true,
					variant: "outline" as const,
					onClick: () => startMutation.mutate(idInput),
					pending: startMutation.isPending,
					disabled: actionPending || !canDeploy,
					hint: deployHint,
				},
		{
			key: "reload",
			label: "Reload",
			icon: RefreshCw,
			onClick: () => reloadMutation.mutate(idInput),
			pending: reloadMutation.isPending,
			disabled: actionPending || !isRunning || !canRuntime,
			hint: !canRuntime ? runtimeHint : isRunning ? undefined : "Start the database first",
		},
	];

	return (
		<div className="flex flex-col gap-6">
			<ServicePageHeader
				projectId={projectId}
				environmentId={(db as { environmentId?: string }).environmentId}
				name={db.name}
				subtitle={`${cfg.label} · ${db.appName}`}
				status={status}
				actions={serviceActions}
			/>

			<AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Stop {cfg.label}</AlertDialogTitle>
						<AlertDialogDescription>
							Stop {db.name}? Connected apps will lose database access until you start it again.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={stopMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={stopMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								stopMutation.mutate(idInput);
							}}
						>
							{stopMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Stop
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Tabs value={topTab} onValueChange={selectTab} activationMode="manual">
				<UnderlineTabsList>
					<UnderlineTabsTrigger value="general">General</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="connection">Connection</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="runtime">Runtime</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="environment">Environment</UnderlineTabsTrigger>
					{cfg.supportsBackups ? (
						<UnderlineTabsTrigger value="backups">Backups</UnderlineTabsTrigger>
					) : null}
					<UnderlineTabsTrigger value="settings">Settings</UnderlineTabsTrigger>
				</UnderlineTabsList>

				<SaveBarTabsContent value="general" className="mt-6">
					<GeneralTab
						ns={ns}
						idInput={idInput}
						db={db}
						type={type}
						label={cfg.label}
						hasDatabaseName={cfg.hasDatabaseName}
						hasUser={cfg.hasUser}
						hasRootPassword={cfg.hasRootPassword}
						invalidate={invalidate}
					/>
				</SaveBarTabsContent>

				<SaveBarTabsContent value="connection" className="mt-6">
					<ConnectionTab
						ns={ns}
						idInput={idInput}
						type={type}
						label={cfg.label}
						hasExternalPort={db.externalPort != null}
						onOpenGeneral={() => selectTab("general")}
						invalidate={invalidate}
					/>
				</SaveBarTabsContent>

				<SaveBarTabsContent value="environment" className="mt-6">
					<EnvironmentTab ns={ns} idInput={idInput} env={db.env} invalidate={invalidate} />
				</SaveBarTabsContent>

				{cfg.supportsBackups && (
					<SaveBarTabsContent value="backups" className="mt-6">
						<BackupsPanel
							target={{
								kind: "database",
								databaseType: type,
								serviceId: id,
								databaseName: type === "redis" ? "0" : (db.databaseName ?? "admin"),
							}}
						/>
					</SaveBarTabsContent>
				)}

				<SaveBarTabsContent value="runtime" className="mt-6">
					<Tabs
						value={runtimeTab}
						onValueChange={selectTab}
						activationMode="manual"
						className="w-full gap-4"
					>
						<SubTabsList>
							<SubTabsTrigger value="logs">Logs</SubTabsTrigger>
							<SubTabsTrigger value="monitoring">Monitoring</SubTabsTrigger>
							<SubTabsTrigger value="terminal">Terminal</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="logs" className="mt-0">
							<SettingsSection bare title="Logs" description="Live container output.">
								<LogViewer
									appName={db.appName}
									serverId={db.serverId}
									serviceStatus={status}
									notRunningAction={runtimeAction}
								/>
							</SettingsSection>
						</TabsContent>
						<TabsContent value="monitoring" className="mt-0">
							<SettingsSection bare title="Monitoring" description="CPU, memory, and network.">
								<MonitoringCharts
									appName={db.appName}
									serverId={db.serverId}
									serviceStatus={status}
									notRunningAction={runtimeAction}
								/>
							</SettingsSection>
						</TabsContent>
						<TabsContent value="terminal" className="mt-0">
							<SettingsSection bare title="Terminal" description="Shell into the container.">
								<ServiceTerminal
									appName={db.appName}
									serverId={db.serverId}
									serviceStatus={status}
									notRunningAction={runtimeAction}
								/>
							</SettingsSection>
						</TabsContent>
					</Tabs>
				</SaveBarTabsContent>

				<SaveBarTabsContent value="settings" className="mt-6">
					<SettingsTab
						ns={ns}
						idInput={idInput}
						db={db}
						type={type}
						projectId={projectId}
						label={cfg.label}
						invalidate={invalidate}
						onRemove={() => removeMutation.mutateAsync(idInput)}
					/>
				</SaveBarTabsContent>
			</Tabs>
		</div>
	);
}

interface TabProps {
	ns: DatabaseRouterFacade;
	idInput: DatabaseIdInput;
	invalidate: () => void;
}

/** Sentinel for the version picker's "no curated version" option. */
const CUSTOM_IMAGE = "__custom__";

function GeneralTab({
	ns,
	idInput,
	db,
	type,
	label,
	hasDatabaseName,
	hasUser,
	hasRootPassword,
	invalidate,
}: TabProps & {
	db: DatabaseRow;
	type: DatabaseType;
	label: string;
	hasDatabaseName: boolean;
	hasUser: boolean;
	hasRootPassword: boolean;
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const writeHint = canWrite ? undefined : capabilityHint("service.write");
	const general = useDraft({
		name: db.name,
		description: db.description ?? "",
		dockerImage: db.dockerImage,
		// "" = custom image; a curated tag otherwise. Rows created before the
		// picker existed are matched back from their image where possible.
		engineVersion: db.engineVersion ?? versionFromImage(type, db.dockerImage) ?? "",
	});
	const { name, description, dockerImage, engineVersion } = general.value;
	const port = useDraft(db.externalPort?.toString() ?? "");
	const savedVersion = db.engineVersion ?? versionFromImage(type, db.dockerImage);
	const versionChange = engineVersion
		? classifyVersionChange(type, savedVersion, engineVersion)
		: ({ kind: "none" } as const);
	const [upgradeAcknowledged, setUpgradeAcknowledged] = useState(false);

	const updateMutation = useSaveMutation(ns.update.mutationOptions(), {
		successMessage: "Settings saved",
		errorMessage: "Failed to save",
		onSuccess: () => {
			general.markSaved();
			invalidate();
		},
	});
	const portMutation = useSaveMutation(ns.saveExternalPort.mutationOptions(), {
		successMessage: "External port saved",
		errorMessage: "Failed to save external port",
		onSuccess: () => {
			port.markSaved();
			invalidate();
		},
	});

	const parsedPort = port.value.trim() === "" ? null : Number(port.value);
	const portValid =
		parsedPort === null || (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535);

	const saveGeneral = () =>
		// The five database routers share one generated input whose computed
		// `<kind>Id` key collapses the inferred type to `{ [x: string]: string }`,
		// so the boolean confirmation flag has to be cast in. The runtime schema
		// does accept it (`buildDatabaseRouter`).
		updateMutation.mutate({
			...idInput,
			name: name.trim(),
			// `undefined` is dropped from the SET clause, so a cleared description
			// could never be persisted. The router's zod schema is
			// `z.string().optional()` (rejects null), so an empty string is the
			// only value that clears it.
			description: description.trim(),
			dockerImage: dockerImage.trim(),
			// Sent only when a curated version is selected: the server derives the
			// image from it and refuses a downgrade.
			...(engineVersion
				? { engineVersion, ...(upgradeAcknowledged ? { confirmMajorUpgrade: true } : {}) }
				: {}),
		} as unknown as Parameters<typeof updateMutation.mutate>[0]);
	const savePort = () => portMutation.mutate({ ...idInput, externalPort: parsedPort });
	const generalBlocked =
		!canWrite ||
		!name.trim() ||
		!dockerImage.trim() ||
		versionChange.kind === "blocked" ||
		(versionChange.kind === "confirm" && !upgradeAcknowledged);

	useSaveBar(general, {
		onSave: saveGeneral,
		pending: updateMutation.isPending,
		disabled: generalBlocked,
	});
	useSaveBar(port, {
		onSave: savePort,
		pending: portMutation.isPending,
		disabled: !canWrite || !portValid,
	});

	return (
		<SettingsStack>
			<SettingsSection title="General" description={`Basic settings for this ${label} instance.`}>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="db-name">Name</Label>
						<Input
							id="db-name"
							value={name}
							onChange={(e) => general.patch({ name: e.target.value })}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="db-description">Description</Label>
						<Textarea
							id="db-description"
							value={description}
							onChange={(e) => general.patch({ description: e.target.value })}
							placeholder="Optional description"
							rows={3}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="db-version">Version</Label>
						<Select
							value={engineVersion || CUSTOM_IMAGE}
							onValueChange={(value) => {
								setUpgradeAcknowledged(false);
								if (value === CUSTOM_IMAGE) {
									general.patch({ engineVersion: "" });
									return;
								}
								// Keep the two fields in step: the server derives the image
								// from the version, so showing a stale one would lie.
								general.patch({
									engineVersion: value,
									dockerImage: imageForVersion(type, value),
								});
							}}
						>
							<SelectTrigger id="db-version">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DATABASE_VERSIONS[type].map((entry) => (
									<SelectItem key={entry.version} value={entry.version}>
										{label} {entry.version}
										{entry.note ? ` — ${entry.note}` : ""}
									</SelectItem>
								))}
								<SelectItem value={CUSTOM_IMAGE}>Custom image…</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-sm text-muted-foreground">
							Pick a version and the image follows. Choose “Custom image” for a variant such as
							Alpine, a fork or a pinned digest.
						</p>
					</div>

					{versionChange.kind === "blocked" && (
						<div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
							{versionChange.reason}
						</div>
					)}

					{versionChange.kind === "confirm" && (
						<div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
							<p className="text-sm text-amber-700 dark:text-amber-400">{versionChange.reason}</p>
							<div className="flex items-start gap-2 text-sm">
								<Checkbox
									id="db-upgrade-ack"
									checked={upgradeAcknowledged}
									onCheckedChange={(checked) => setUpgradeAcknowledged(checked === true)}
								/>
								<Label htmlFor="db-upgrade-ack" className="font-normal">
									I have a current backup of this database
								</Label>
							</div>
						</div>
					)}

					<div className="space-y-1.5">
						<Label htmlFor="db-image">Docker image</Label>
						<Input
							id="db-image"
							value={dockerImage}
							disabled={Boolean(engineVersion)}
							onChange={(e) => general.patch({ dockerImage: e.target.value })}
							className="font-mono"
						/>
						<p className="text-sm text-muted-foreground">
							{engineVersion
								? "Derived from the version above. Switch to “Custom image” to edit it."
								: "Reload the service after changing the image for it to take effect."}
						</p>
					</div>
					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={general.dirty} />
						<DisabledHint hint={writeHint}>
							<Button disabled={updateMutation.isPending || generalBlocked} onClick={saveGeneral}>
								{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection
				title="Credentials"
				description="Auto-generated credentials for this instance."
			>
				<div className="space-y-4">
					{hasUser && db.databaseUser && <ReadOnlyField label="Username" value={db.databaseUser} />}
					{hasDatabaseName && db.databaseName && (
						<ReadOnlyField label="Database" value={db.databaseName} />
					)}
					{db.databasePassword && <SecretField label="Password" value={db.databasePassword} />}
					{hasRootPassword && db.databaseRootPassword && (
						<SecretField label="Root password" value={db.databaseRootPassword} />
					)}
				</div>
			</SettingsSection>

			<SettingsSection
				title="External port"
				description="Off by default. Your own services in this environment already reach the database by name — a port is only needed for tools outside the platform."
			>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="db-port">Port</Label>
						<Input
							id="db-port"
							type="number"
							min={1}
							max={65535}
							placeholder="e.g. 35432"
							value={port.value}
							onChange={(e) => port.set(e.target.value)}
						/>
						<p className="text-sm text-muted-foreground">
							Swarm publishes host ports on <strong>every</strong> network interface — there is no
							localhost-only option — so the database becomes reachable from anywhere that can route
							to this server. Firewall the port, keep the password strong, and leave this empty
							unless you need it. Privileged ports, the default database ports and the platform's
							own ports are rejected.
						</p>
						{!portValid && (
							<p className="text-sm text-destructive">Enter a port between 1 and 65535.</p>
						)}
					</div>
					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={port.dirty} />
						<DisabledHint hint={writeHint}>
							<Button
								disabled={portMutation.isPending || !portValid || !canWrite}
								onClick={savePort}
							>
								{portMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Save port
							</Button>
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>
		</SettingsStack>
	);
}

/**
 * Extra logical databases (and their owning users) inside one engine. Redis
 * has no equivalent, so the section is not rendered for it.
 *
 * Creating one runs `CREATE DATABASE` / `CREATE USER` inside the running
 * container, so the service has to be up; the generated password follows the
 * same reveal rules as the primary credentials (nulled without
 * `secrets.read`).
 */
function LogicalDatabasesSection({
	ns,
	idInput,
	label,
	invalidate,
}: {
	ns: DatabaseRouterFacade;
	idInput: DatabaseIdInput;
	label: string;
	invalidate: () => void;
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const canDelete = can("service.delete");
	const canReadSecrets = can("secrets.read");

	// `listLogicalDatabases` is generated by the same factory as the rest of
	// the router but is not on the facade's postgres shape yet.
	const logicalNs = ns as unknown as {
		listLogicalDatabases: DatabaseRouterFacade["one"];
		createLogicalDatabase: DatabaseRouterFacade["update"];
		deleteLogicalDatabase: DatabaseRouterFacade["update"];
	};
	type LogicalRow = {
		databaseLogicalId: string;
		name: string;
		username: string;
		password: string | null;
		connectionUrl: string | null;
	};

	const listQuery = useQuery(logicalNs.listLogicalDatabases.queryOptions(idInput));
	const rows = (listQuery.data ?? []) as unknown as LogicalRow[];

	const [dialogOpen, setDialogOpen] = useState(false);
	const [name, setName] = useState("");
	const [username, setUsername] = useState("");
	const [deleting, setDeleting] = useState<LogicalRow | null>(null);

	const refresh = () => {
		listQuery.refetch();
		invalidate();
	};
	const createMutation = useSaveMutation(
		logicalNs.createLogicalDatabase.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Database created", errorMessage: "Failed to create the database" },
	);
	const deleteMutation = useSaveMutation(
		logicalNs.deleteLogicalDatabase.mutationOptions({ onSuccess: () => setDeleting(null) }),
		{ successMessage: "Database deleted", errorMessage: "Failed to delete the database" },
	);

	const submit = () => {
		const trimmed = name.trim().toLowerCase();
		if (!/^[a-z_][a-z0-9_]{0,62}$/.test(trimmed)) {
			toast.error("Use lowercase letters, digits and underscores, starting with a letter");
			return;
		}
		const trimmedUser = username.trim().toLowerCase();
		if (trimmedUser && !/^[a-z_][a-z0-9_]{0,62}$/.test(trimmedUser)) {
			toast.error("Username must use lowercase letters, digits and underscores");
			return;
		}
		createMutation.mutate(
			{
				...idInput,
				name: trimmed,
				...(trimmedUser ? { username: trimmedUser } : {}),
			} as unknown as Parameters<typeof createMutation.mutate>[0],
			{ onSuccess: refresh },
		);
	};

	return (
		<SettingsSection
			title="Additional databases"
			description={`Extra logical databases inside this ${label} instance, each with its own owning user.`}
			actions={
				<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
					<Button
						size="sm"
						disabled={!canWrite}
						onClick={() => {
							setName("");
							setUsername("");
							setDialogOpen(true);
						}}
					>
						Add database
					</Button>
				</DisabledHint>
			}
		>
			<QueryState
				isPending={listQuery.isLoading}
				isError={listQuery.isError}
				error={listQuery.error as { message?: string } | null}
				onRetry={() => listQuery.refetch()}
				skeleton={<Skeleton className="h-16 w-full" />}
				isEmpty={rows.length === 0}
				empty={
					<p className="text-sm text-muted-foreground">
						No additional databases. The instance must be running to create one.
					</p>
				}
			>
				<div className="space-y-4">
					{rows.map((row) => (
						<div key={row.databaseLogicalId} className="space-y-2 rounded-lg border p-3">
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span className="font-mono text-sm">{row.name}</span>
									<Badge variant="outline" className="text-xs">
										{row.username}
									</Badge>
								</div>
								<DisabledHint hint={canDelete ? undefined : capabilityHint("service.delete")}>
									<Button
										variant="ghost"
										size="sm"
										disabled={!canDelete}
										onClick={() => setDeleting(row)}
									>
										Delete
									</Button>
								</DisabledHint>
							</div>
							{row.connectionUrl ? (
								<ConnectionUrlField url={row.connectionUrl} />
							) : (
								<p className="text-sm text-muted-foreground">
									{canReadSecrets
										? "Connection URL unavailable."
										: "The connection URL is hidden — it needs the secrets.read capability."}
								</p>
							)}
						</div>
					))}
				</div>
			</QueryState>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Add database</DialogTitle>
						<DialogDescription>
							Creates a database and an owning user inside the running {label} container. The
							password is generated and stored encrypted.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
						className="space-y-4"
					>
						<div className="space-y-1.5">
							<Label htmlFor="logical-name">Database name</Label>
							<Input
								id="logical-name"
								placeholder="analytics"
								value={name}
								onChange={(event) => setName(event.target.value)}
								className="font-mono"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="logical-user">Username (optional)</Label>
							<Input
								id="logical-user"
								placeholder={`${name.trim().toLowerCase() || "analytics"}_user`}
								value={username}
								onChange={(event) => setUsername(event.target.value)}
								className="font-mono"
							/>
							<p className="text-sm text-muted-foreground">
								Leave empty to name the user after the database.
							</p>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Create
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete database</AlertDialogTitle>
						<AlertDialogDescription>
							Drop <span className="font-mono">{deleting?.name}</span> and its user{" "}
							<span className="font-mono">{deleting?.username}</span>? Everything in it is deleted
							permanently.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (!deleting) return;
								deleteMutation.mutate(
									{
										...idInput,
										databaseLogicalId: deleting.databaseLogicalId,
									} as unknown as Parameters<typeof deleteMutation.mutate>[0],
									{ onSuccess: refresh },
								);
							}}
						>
							{deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsSection>
	);
}

function ConnectionTab({
	ns,
	idInput,
	type,
	label,
	hasExternalPort,
	onOpenGeneral,
	invalidate,
}: {
	ns: DatabaseRouterFacade;
	idInput: DatabaseIdInput;
	type: DatabaseType;
	label: string;
	hasExternalPort: boolean;
	/** Jump to the General tab, where the external port is configured. */
	onOpenGeneral: () => void;
	invalidate: () => void;
}) {
	const urlsQuery = useQuery(ns.getConnectionUrl.queryOptions(idInput));
	const urls = urlsQuery.data as ConnectionUrls | undefined;

	// One QueryState for both sections: the procedure requires secrets.read, so
	// a FORBIDDEN must read as "you cannot see this" (with Retry), not as
	// "no URL configured".
	return (
		<QueryState
			isPending={urlsQuery.isLoading}
			isError={urlsQuery.isError}
			error={urlsQuery.error as { message?: string } | null}
			onRetry={() => urlsQuery.refetch()}
			skeleton={
				<SettingsStack>
					<SettingsSection
						title="Internal connection URL"
						description="Use this URL from services deployed on the internal network."
					>
						<Skeleton className="h-9 w-full" />
					</SettingsSection>
					<SettingsSection
						title="External connection URL"
						description="Use this URL to connect from outside this server (requires an external port)."
					>
						<Skeleton className="h-9 w-full" />
					</SettingsSection>
				</SettingsStack>
			}
			isEmpty={!urls}
			empty={<p className="text-sm text-muted-foreground">Connection URL unavailable.</p>}
		>
			<SettingsStack>
				<SettingsSection
					title="Internal connection URL"
					description="Use this URL from services deployed on the internal network."
				>
					<ConnectionUrlField url={urls?.internal ?? ""} />
				</SettingsSection>

				<SettingsSection
					title="External connection URL"
					description="Use this URL to connect from outside this server (requires an external port)."
				>
					{urls?.external ? (
						<ConnectionUrlField url={urls.external} />
					) : hasExternalPort ? (
						<p className="text-sm text-muted-foreground">External URL unavailable.</p>
					) : (
						<p className="text-sm text-muted-foreground">
							No external port configured.{" "}
							<button
								type="button"
								onClick={onOpenGeneral}
								className="font-medium text-foreground underline-offset-4 hover:underline"
							>
								Set one in the General tab →
							</button>
						</p>
					)}
				</SettingsSection>

				{type !== "redis" && (
					<LogicalDatabasesSection
						ns={ns}
						idInput={idInput}
						label={label}
						invalidate={invalidate}
					/>
				)}
			</SettingsStack>
		</QueryState>
	);
}

function EnvironmentTab({ ns, idInput, env, invalidate }: TabProps & { env: string | null }) {
	const { can } = useCapabilities();
	const saveMutation = useSaveMutation(ns.saveEnvironment.mutationOptions(), {
		successMessage: "Environment variables saved",
		errorMessage: "Failed to save",
		onSuccess: invalidate,
	});

	return (
		<SettingsSection
			title="Environment variables"
			description="Service-level variables. Reload the service to apply changes."
		>
			<EnvEditor
				value={env}
				loading={saveMutation.isPending}
				// The server nulls `env` for members without secrets.read; the editor
				// cannot tell that apart from an unset env, so pass the capability.
				canRead={can("secrets.read")}
				canEdit={can("secrets.write")}
				onSave={(nextEnv) => saveMutation.mutateAsync({ ...idInput, env: nextEnv })}
			/>
		</SettingsSection>
	);
}

/** `duplicate` / `move` exist on every database router but not on the facade type. */
interface DatabaseMoveDuplicateFacade {
	duplicate: DatabaseRouterFacade["duplicate"];
	move: DatabaseRouterFacade["move"];
}

function SettingsTab({
	ns,
	idInput,
	db,
	type,
	projectId,
	label,
	invalidate,
	onRemove,
}: TabProps & {
	db: DatabaseRow;
	type: DatabaseType;
	projectId: string;
	label: string;
	/** Must return the delete promise (`mutateAsync`) so DangerZone can await it. */
	onRemove: () => Promise<unknown>;
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const canDelete = can("service.delete");
	const nameDraft = useDraft(db.name);
	const name = nameDraft.value;
	const cfg = DATABASE_TYPES[type];
	const actions = ns as unknown as DatabaseMoveDuplicateFacade;
	const duplicateMutation = useMutation(actions.duplicate.mutationOptions());
	const moveMutation = useMutation(
		actions.move.mutationOptions({
			onSuccess: () => invalidate(),
		}),
	);
	// Renaming the copy must not reuse `renameMutation` (its toast/invalidate).
	const renameCopyMutation = useMutation(ns.update.mutationOptions());
	// The normalized row type omits environmentId; every engine row carries it.
	const environmentId = (db as { environmentId?: string }).environmentId ?? "";

	const renameMutation = useSaveMutation(ns.update.mutationOptions(), {
		successMessage: "Database renamed",
		errorMessage: "Failed to rename",
		onSuccess: () => {
			nameDraft.markSaved();
			invalidate();
		},
	});

	const renameBlocked = !canWrite || !name.trim() || name.trim() === db.name;
	const onRename = () => renameMutation.mutate({ ...idInput, name: name.trim() });
	useSaveBar(nameDraft, {
		onSave: onRename,
		pending: renameMutation.isPending,
		disabled: renameBlocked,
	});

	return (
		<SettingsStack>
			<SettingsSection
				title="Rename"
				description={`Change the display name of this ${label} instance.`}
			>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="rename-input">Name</Label>
						<Input id="rename-input" value={name} onChange={(e) => nameDraft.set(e.target.value)} />
					</div>
					<div className="flex items-center justify-end gap-3">
						<UnsavedChangesPill dirty={nameDraft.dirty} />
						<DisabledHint hint={canWrite ? undefined : capabilityHint("service.write")}>
							<Button disabled={renameMutation.isPending || renameBlocked} onClick={onRename}>
								{renameMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Rename
							</Button>
						</DisabledHint>
					</div>
				</div>
			</SettingsSection>

			<ServiceActionsCard
				kind={type}
				serviceName={db.name}
				projectId={projectId}
				environmentId={environmentId}
				onDuplicate={async (targetEnvironmentId) => {
					const created = (await duplicateMutation.mutateAsync({
						...idInput,
						environmentId: targetEnvironmentId,
					})) as Record<string, unknown>;
					return String(created[cfg.idField]);
				}}
				onRename={(id, nextName) => {
					// Keyed id input ({ postgresId } / { mysqlId } / …) — untyped behind the facade.
					const input = { ...databaseIdInput(type, id), name: nextName };
					return renameCopyMutation.mutateAsync(input);
				}}
				onMove={(targetEnvironmentId) =>
					moveMutation.mutateAsync({ ...idInput, environmentId: targetEnvironmentId })
				}
			/>

			<DangerZone
				title="Delete database"
				description={`Permanently delete this ${label} instance, its container and its data volume. This action cannot be undone.`}
				actionLabel="Delete database"
				requireText={db.name}
				disabled={!canDelete}
				disabledReason={capabilityHint("service.delete")}
				onConfirm={onRemove}
			/>
		</SettingsStack>
	);
}
