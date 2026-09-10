"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	Copy,
	Eye,
	EyeOff,
	Loader2,
	MoreVertical,
	Play,
	RefreshCw,
	Square,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { DatabaseBackups } from "@/components/databases/database-backups";
import {
	type ConnectionUrls,
	DATABASE_TYPES,
	type DatabaseIdInput,
	type DatabaseRouterFacade,
	type DatabaseRow,
	type DatabaseType,
	type ServiceStatus,
} from "@/components/databases/database-types";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { DangerZone } from "@/components/services/danger-zone";
import { EnvEditor } from "@/components/services/env-editor";
import { LogViewer } from "@/components/services/log-viewer";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { ServiceTerminal } from "@/components/services/service-terminal";
import { ServiceStatusBadge } from "@/components/services/status-badge";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSyncedTab } from "@/hooks/use-synced-tab";
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

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className="size-7 shrink-0"
			onClick={async () => {
				await navigator.clipboard.writeText(value);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
		>
			{copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
			<span className="sr-only">Copy</span>
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
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7 shrink-0"
					onClick={() => setRevealed((v) => !v)}
				>
					{revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
					<span className="sr-only">{revealed ? "Hide" : "Reveal"}</span>
				</Button>
				<CopyButton value={value} />
			</div>
		</div>
	);
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<div className="flex items-center gap-1">
				<Input readOnly value={value} className="font-mono" />
				<CopyButton value={value} />
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
	const idInput: DatabaseIdInput = useMemo(() => ({ [cfg.idField]: id }), [cfg.idField, id]);

	const rowQuery = useQuery(ns.one.queryOptions(idInput));
	const db = rowQuery.data as DatabaseRow | undefined;

	const statusQuery = useQuery(
		ns.getStatus.queryOptions(idInput, { refetchInterval: 30_000, retry: false }),
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

	const onError = (error: { message?: string }) =>
		toast.error(error.message ?? "Something went wrong");

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

	const topTabs = [
		"general",
		"connection",
		"environment",
		...(cfg.supportsBackups ? ["backups"] : []),
		"runtime",
		"settings",
	];
	const [tab, selectTab] = useSyncedTab(
		"general",
		(value) => topTabs.includes(value) || value in SUB_TAB_PARENT,
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

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				breadcrumb={
					<>
						<Link
							href={`/dashboard/projects/${projectId}`}
							className="transition-colors hover:text-foreground"
						>
							Project
						</Link>
						<span className="mx-1.5">/</span>
						{cfg.label}
					</>
				}
				title={
					<span className="flex items-center gap-2.5">
						{db.name}
						<ServiceStatusBadge status={status} />
					</span>
				}
				description={`${cfg.label} · ${db.appName}`}
				actions={
					<>
						{status === "running" || status === "done" ? (
							<Button
								variant="outline"
								size="sm"
								disabled={actionPending || !canRuntime}
								title={runtimeHint}
								onClick={() => setConfirmStop(true)}
							>
								{stopMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Square className="size-4" />
								)}
								Stop
							</Button>
						) : (
							<Button
								variant="outline"
								size="sm"
								disabled={actionPending || !canDeploy}
								title={deployHint}
								onClick={() => startMutation.mutate(idInput)}
							>
								{startMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Play className="size-4" />
								)}
								Start
							</Button>
						)}
						<Button
							variant="outline"
							size="sm"
							className="hidden sm:inline-flex"
							disabled={actionPending || (status !== "running" && status !== "done") || !canRuntime}
							title={runtimeHint}
							onClick={() => reloadMutation.mutate(idInput)}
						>
							{reloadMutation.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<RefreshCw className="size-4" />
							)}
							Reload
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="outline"
									size="icon"
									className="sm:hidden"
									aria-label="More actions"
									disabled={actionPending}
								>
									<MoreVertical className="size-4" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									disabled={
										actionPending || (status !== "running" && status !== "done") || !canRuntime
									}
									title={runtimeHint}
									onClick={() => reloadMutation.mutate(idInput)}
								>
									<RefreshCw className="size-4" />
									Reload
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				}
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

			<Tabs value={topTab} onValueChange={selectTab}>
				<UnderlineTabsList>
					<UnderlineTabsTrigger value="general">General</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="connection">Connection</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="environment">Environment</UnderlineTabsTrigger>
					{cfg.supportsBackups ? (
						<UnderlineTabsTrigger value="backups">Backups</UnderlineTabsTrigger>
					) : null}
					<UnderlineTabsTrigger value="runtime">Runtime</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="settings">Settings</UnderlineTabsTrigger>
				</UnderlineTabsList>

				<TabsContent value="general" className="mt-6">
					<GeneralTab
						ns={ns}
						idInput={idInput}
						db={db}
						label={cfg.label}
						hasDatabaseName={cfg.hasDatabaseName}
						hasUser={cfg.hasUser}
						hasRootPassword={cfg.hasRootPassword}
						invalidate={invalidate}
					/>
				</TabsContent>

				<TabsContent value="connection" className="mt-6">
					<ConnectionTab ns={ns} idInput={idInput} hasExternalPort={db.externalPort != null} />
				</TabsContent>

				<TabsContent value="environment" className="mt-6">
					<EnvironmentTab ns={ns} idInput={idInput} env={db.env} invalidate={invalidate} />
				</TabsContent>

				{cfg.supportsBackups && (
					<TabsContent value="backups" className="mt-6">
						<DatabaseBackups
							databaseType={type}
							serviceId={id}
							databaseName={type === "redis" ? "0" : (db.databaseName ?? "admin")}
						/>
					</TabsContent>
				)}

				<TabsContent value="runtime" className="mt-6">
					<Tabs value={runtimeTab} onValueChange={selectTab} className="w-full gap-4">
						<SubTabsList>
							<SubTabsTrigger value="logs">Logs</SubTabsTrigger>
							<SubTabsTrigger value="monitoring">Monitoring</SubTabsTrigger>
							<SubTabsTrigger value="terminal">Terminal</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="logs" className="mt-0">
							<SettingsSection bare title="Logs" description="Live container output.">
								<LogViewer appName={db.appName} serverId={db.serverId} />
							</SettingsSection>
						</TabsContent>
						<TabsContent value="monitoring" className="mt-0">
							<SettingsSection bare title="Monitoring" description="CPU, memory, and network.">
								<MonitoringCharts appName={db.appName} serverId={db.serverId} />
							</SettingsSection>
						</TabsContent>
						<TabsContent value="terminal" className="mt-0">
							<SettingsSection bare title="Terminal" description="Shell into the container.">
								<ServiceTerminal appName={db.appName} serverId={db.serverId} />
							</SettingsSection>
						</TabsContent>
					</Tabs>
				</TabsContent>

				<TabsContent value="settings" className="mt-6">
					<SettingsTab
						ns={ns}
						idInput={idInput}
						db={db}
						label={cfg.label}
						invalidate={invalidate}
						onRemove={() => removeMutation.mutateAsync(idInput)}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}

interface TabProps {
	ns: DatabaseRouterFacade;
	idInput: DatabaseIdInput;
	invalidate: () => void;
}

function GeneralTab({
	ns,
	idInput,
	db,
	label,
	hasDatabaseName,
	hasUser,
	hasRootPassword,
	invalidate,
}: TabProps & {
	db: DatabaseRow;
	label: string;
	hasDatabaseName: boolean;
	hasUser: boolean;
	hasRootPassword: boolean;
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const writeHint = canWrite ? undefined : capabilityHint("service.write");
	const [name, setName] = useState(db.name);
	const [description, setDescription] = useState(db.description ?? "");
	const [dockerImage, setDockerImage] = useState(db.dockerImage);
	const [externalPort, setExternalPort] = useState(db.externalPort?.toString() ?? "");

	const updateMutation = useMutation(
		ns.update.mutationOptions({
			onSuccess: () => {
				toast.success("Settings saved");
				invalidate();
			},
			onError: (error: { message?: string }) => toast.error(error.message ?? "Failed to save"),
		}),
	);
	const portMutation = useMutation(
		ns.saveExternalPort.mutationOptions({
			onSuccess: () => {
				toast.success("External port saved");
				invalidate();
			},
			onError: (error: { message?: string }) =>
				toast.error(error.message ?? "Failed to save external port"),
		}),
	);

	const parsedPort = externalPort.trim() === "" ? null : Number(externalPort);
	const portValid =
		parsedPort === null || (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535);

	return (
		<SettingsStack>
			<SettingsSection title="General" description={`Basic settings for this ${label} instance.`}>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="db-name">Name</Label>
						<Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="db-description">Description</Label>
						<Textarea
							id="db-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Optional description"
							rows={3}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="db-image">Docker image</Label>
						<Input
							id="db-image"
							value={dockerImage}
							onChange={(e) => setDockerImage(e.target.value)}
							className="font-mono"
						/>
						<p className="text-sm text-muted-foreground">
							Reload the service after changing the image for it to take effect.
						</p>
					</div>
					<div className="flex justify-end">
						<Button
							disabled={
								updateMutation.isPending || !name.trim() || !dockerImage.trim() || !canWrite
							}
							title={writeHint}
							onClick={() =>
								updateMutation.mutate({
									...idInput,
									name: name.trim(),
									// `undefined` is dropped from the SET clause, so a cleared
									// description could never be persisted. The router's zod
									// schema is `z.string().optional()` (rejects null), so an
									// empty string is the only value that clears it.
									description: description.trim(),
									dockerImage: dockerImage.trim(),
								})
							}
						>
							{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
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
				description="Host port for external access. Leave empty for internal-only."
			>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="db-port">Port</Label>
						<Input
							id="db-port"
							type="number"
							min={1}
							max={65535}
							placeholder="e.g. 5432"
							value={externalPort}
							onChange={(e) => setExternalPort(e.target.value)}
						/>
						{!portValid && (
							<p className="text-sm text-destructive">Enter a port between 1 and 65535.</p>
						)}
					</div>
					<div className="flex justify-end">
						<Button
							disabled={portMutation.isPending || !portValid || !canWrite}
							title={writeHint}
							onClick={() => portMutation.mutate({ ...idInput, externalPort: parsedPort })}
						>
							{portMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Save port
						</Button>
					</div>
				</div>
			</SettingsSection>
		</SettingsStack>
	);
}

function ConnectionTab({
	ns,
	idInput,
	hasExternalPort,
}: {
	ns: DatabaseRouterFacade;
	idInput: DatabaseIdInput;
	hasExternalPort: boolean;
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
					<div className="flex items-center gap-1">
						<Input readOnly value={urls?.internal ?? ""} className="font-mono text-xs" />
						<CopyButton value={urls?.internal ?? ""} />
					</div>
				</SettingsSection>

				<SettingsSection
					title="External connection URL"
					description="Use this URL to connect from outside this server (requires an external port)."
				>
					{urls?.external ? (
						<div className="flex items-center gap-1">
							<Input readOnly value={urls.external} className="font-mono text-xs" />
							<CopyButton value={urls.external} />
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							{hasExternalPort
								? "External URL unavailable."
								: "No external port configured. Set one in the General tab to enable external access."}
						</p>
					)}
				</SettingsSection>
			</SettingsStack>
		</QueryState>
	);
}

function EnvironmentTab({ ns, idInput, env, invalidate }: TabProps & { env: string | null }) {
	const { can } = useCapabilities();
	const saveMutation = useMutation(
		ns.saveEnvironment.mutationOptions({
			onSuccess: () => {
				toast.success("Environment variables saved");
				invalidate();
			},
			onError: (error: { message?: string }) => toast.error(error.message ?? "Failed to save"),
		}),
	);

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

function SettingsTab({
	ns,
	idInput,
	db,
	label,
	invalidate,
	onRemove,
}: TabProps & {
	db: DatabaseRow;
	label: string;
	/** Must return the delete promise (`mutateAsync`) so DangerZone can await it. */
	onRemove: () => Promise<unknown>;
}) {
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const canDelete = can("service.delete");
	const [name, setName] = useState(db.name);

	const renameMutation = useMutation(
		ns.update.mutationOptions({
			onSuccess: () => {
				toast.success("Database renamed");
				invalidate();
			},
			onError: (error: { message?: string }) => toast.error(error.message ?? "Failed to rename"),
		}),
	);

	return (
		<SettingsStack>
			<SettingsSection
				title="Rename"
				description={`Change the display name of this ${label} instance.`}
			>
				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="rename-input">Name</Label>
						<Input id="rename-input" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="flex justify-end">
						<Button
							disabled={
								renameMutation.isPending || !name.trim() || name.trim() === db.name || !canWrite
							}
							title={canWrite ? undefined : capabilityHint("service.write")}
							onClick={() => renameMutation.mutate({ ...idInput, name: name.trim() })}
						>
							{renameMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Rename
						</Button>
					</div>
				</div>
			</SettingsSection>

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
