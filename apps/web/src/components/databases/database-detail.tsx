"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	Copy,
	Eye,
	EyeOff,
	Loader2,
	Play,
	RefreshCw,
	Square,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import { EnvEditor } from "@/components/services/env-editor";
import { LogViewer } from "@/components/services/log-viewer";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { ServiceTerminal } from "@/components/services/service-terminal";
import { ServiceStatusBadge } from "@/components/services/status-badge";
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
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/lib/trpc";

interface DatabaseDetailProps {
	type: DatabaseType;
	/** Service id (postgresId / mysqlId / ... depending on `type`). */
	id: string;
	projectId: string;
}

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
				router.push(`/dashboard/projects/${projectId}`);
			},
			onError,
		}),
	);

	const actionPending =
		startMutation.isPending || stopMutation.isPending || reloadMutation.isPending;

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
				<Button variant="outline" onClick={() => router.push(`/dashboard/projects/${projectId}`)}>
					Back to project
				</Button>
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
						{status === "running" ? (
							<Button
								variant="outline"
								size="sm"
								disabled={actionPending}
								onClick={() => stopMutation.mutate(idInput)}
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
								disabled={actionPending}
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
							disabled={actionPending || status !== "running"}
							onClick={() => reloadMutation.mutate(idInput)}
						>
							{reloadMutation.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<RefreshCw className="size-4" />
							)}
							Reload
						</Button>
					</>
				}
			/>

			<Tabs defaultValue="general">
				<TabsList variant="line" className="w-full flex-wrap justify-start border-b">
					<TabsTrigger value="general">General</TabsTrigger>
					<TabsTrigger value="connection">Connection</TabsTrigger>
					<TabsTrigger value="environment">Environment</TabsTrigger>
					{cfg.supportsBackups && <TabsTrigger value="backups">Backups</TabsTrigger>}
					<TabsTrigger value="logs">Logs</TabsTrigger>
					<TabsTrigger value="monitoring">Monitoring</TabsTrigger>
					<TabsTrigger value="terminal">Terminal</TabsTrigger>
					<TabsTrigger value="settings">Settings</TabsTrigger>
				</TabsList>

				<TabsContent value="general">
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

				<TabsContent value="connection">
					<ConnectionTab ns={ns} idInput={idInput} hasExternalPort={db.externalPort != null} />
				</TabsContent>

				<TabsContent value="environment">
					<EnvironmentTab ns={ns} idInput={idInput} env={db.env} invalidate={invalidate} />
				</TabsContent>

				{cfg.supportsBackups && (
					<TabsContent value="backups">
						<DatabaseBackups
							databaseType={type as Exclude<DatabaseType, "redis">}
							serviceId={id}
							databaseName={db.databaseName ?? "admin"}
						/>
					</TabsContent>
				)}

				<TabsContent value="logs">
					<Card>
						<CardContent className="pt-6">
							<LogViewer appName={db.appName} serverId={db.serverId} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="monitoring">
					<Card>
						<CardContent className="pt-6">
							<MonitoringCharts appName={db.appName} serverId={db.serverId} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="terminal">
					<Card>
						<CardContent className="pt-6">
							<ServiceTerminal appName={db.appName} serverId={db.serverId} />
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="settings">
					<SettingsTab
						ns={ns}
						idInput={idInput}
						db={db}
						label={cfg.label}
						invalidate={invalidate}
						onRemove={() => removeMutation.mutate(idInput)}
						removePending={removeMutation.isPending}
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
		<div className="grid gap-4 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">General</CardTitle>
					<CardDescription>Basic settings for this {label} instance.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
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
				</CardContent>
				<CardFooter>
					<Button
						disabled={updateMutation.isPending || !name.trim() || !dockerImage.trim()}
						onClick={() =>
							updateMutation.mutate({
								...idInput,
								name: name.trim(),
								description: description.trim() || undefined,
								dockerImage: dockerImage.trim(),
							})
						}
					>
						{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</CardFooter>
			</Card>

			<div className="flex flex-col gap-4">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">Credentials</CardTitle>
						<CardDescription>Auto-generated credentials for this instance.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{hasUser && db.databaseUser && (
							<ReadOnlyField label="Username" value={db.databaseUser} />
						)}
						{hasDatabaseName && db.databaseName && (
							<ReadOnlyField label="Database" value={db.databaseName} />
						)}
						{db.databasePassword && <SecretField label="Password" value={db.databasePassword} />}
						{hasRootPassword && db.databaseRootPassword && (
							<SecretField label="Root password" value={db.databaseRootPassword} />
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm font-medium">External port</CardTitle>
						<CardDescription>
							Publish a host port so the database is reachable from outside the internal network.
							Leave empty for internal-only access.
						</CardDescription>
					</CardHeader>
					<CardContent>
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
					</CardContent>
					<CardFooter>
						<Button
							disabled={portMutation.isPending || !portValid}
							onClick={() => portMutation.mutate({ ...idInput, externalPort: parsedPort })}
						>
							{portMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Save port
						</Button>
					</CardFooter>
				</Card>
			</div>
		</div>
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

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Internal connection URL</CardTitle>
					<CardDescription>
						Use this URL from services deployed on the internal network.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{urlsQuery.isLoading ? (
						<Skeleton className="h-9 w-full" />
					) : urls ? (
						<div className="flex items-center gap-1">
							<Input readOnly value={urls.internal} className="font-mono text-xs" />
							<CopyButton value={urls.internal} />
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Connection URL unavailable.</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">External connection URL</CardTitle>
					<CardDescription>
						Use this URL to connect from outside this server (requires an external port).
					</CardDescription>
				</CardHeader>
				<CardContent>
					{urlsQuery.isLoading ? (
						<Skeleton className="h-9 w-full" />
					) : urls?.external ? (
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
				</CardContent>
			</Card>
		</div>
	);
}

function EnvironmentTab({ ns, idInput, env, invalidate }: TabProps & { env: string | null }) {
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
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Environment variables</CardTitle>
				<CardDescription>
					Service-level variables. Reload the service to apply changes.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<EnvEditor
					value={env ?? ""}
					loading={saveMutation.isPending}
					onSave={(nextEnv) => saveMutation.mutate({ ...idInput, env: nextEnv })}
				/>
			</CardContent>
		</Card>
	);
}

function SettingsTab({
	ns,
	idInput,
	db,
	label,
	invalidate,
	onRemove,
	removePending,
}: TabProps & {
	db: DatabaseRow;
	label: string;
	onRemove: () => void;
	removePending: boolean;
}) {
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
		<div className="flex max-w-2xl flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="text-sm font-medium">Rename</CardTitle>
					<CardDescription>Change the display name of this {label} instance.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-1.5">
					<Label htmlFor="rename-input">Name</Label>
					<Input id="rename-input" value={name} onChange={(e) => setName(e.target.value)} />
				</CardContent>
				<CardFooter>
					<Button
						disabled={renameMutation.isPending || !name.trim() || name.trim() === db.name}
						onClick={() => renameMutation.mutate({ ...idInput, name: name.trim() })}
					>
						{renameMutation.isPending && <Loader2 className="size-4 animate-spin" />}
						Rename
					</Button>
				</CardFooter>
			</Card>

			<Card className="border-destructive/40">
				<CardHeader>
					<CardTitle className="text-sm font-medium text-destructive">Danger zone</CardTitle>
					<CardDescription>
						Permanently delete this {label} instance, its container and its data volume. This action
						cannot be undone.
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="destructive" disabled={removePending}>
								{removePending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Trash2 className="size-4" />
								)}
								Delete database
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Delete {db.name}?</AlertDialogTitle>
								<AlertDialogDescription>
									This permanently removes the {label} service, its container and its data volume.
									This action cannot be undone.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction variant="destructive" onClick={onRemove}>
									Delete
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</CardFooter>
			</Card>
		</div>
	);
}
