"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	File as FileIcon,
	Folder,
	FolderOpen,
	FolderPlus,
	Link2,
	Loader2,
	Lock,
	RefreshCw,
	Save,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
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
import { CodeEditor } from "@/components/ui/code-editor";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import { DockerError, type DockerTabProps, invalidateDockerQueries } from "./docker-view";

type VolumeRow = {
	Name: string;
	Driver: string;
	Mountpoint: string;
	protected?: boolean;
};

export function VolumesTab({ serverId }: DockerTabProps) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState<VolumeRow | null>(null);
	const [browsing, setBrowsing] = useState<VolumeRow | null>(null);
	const [pruneOpen, setPruneOpen] = useState(false);

	const volumesQuery = useQuery(trpc.docker.volumes.queryOptions({ serverId }));

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.docker.volumes.queryKey({ serverId }),
		});

	const removeMutation = useSaveMutation(
		trpc.docker.volumeRemove.mutationOptions({ onSuccess: () => setRemoving(null) }),
		{
			successMessage: "Volume removed",
			// Disk usage on the System tab changes too.
			onSuccess: () => void invalidateDockerQueries(queryClient, trpc, serverId),
		},
	);
	const pruneMutation = useSaveMutation(
		trpc.docker.volumesPrune.mutationOptions({
			// The toast carries the reclaimed size, so it stays here.
			onSuccess: (output) =>
				toast.success("Unused volumes pruned", {
					description: output.trim().split("\n").pop() ?? undefined,
				}),
		}),
		{
			onSuccess: () => {
				setPruneOpen(false);
				void invalidateDockerQueries(queryClient, trpc, serverId);
			},
		},
	);

	if (volumesQuery.isLoading) return <Skeleton className="h-64 w-full" />;
	if (volumesQuery.isError) return <DockerError error={volumesQuery.error} />;

	const volumes = (volumesQuery.data ?? []) as VolumeRow[];

	return (
		<div className="space-y-3 pt-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted-foreground">{volumes.length} volumes</p>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => setPruneOpen(true)}>
						Prune unused
					</Button>
					<Button variant="outline" size="sm" onClick={invalidate}>
						<RefreshCw className="size-3.5" />
						Refresh
					</Button>
				</div>
			</div>

			<TableCard>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Driver</TableHead>
							<TableHead>Mountpoint</TableHead>
							<TableHead className="w-16 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{volumes.map((volume) => (
							<TableRow key={volume.Name}>
								<TableCell className="max-w-72">
									<span className="font-mono text-xs font-medium">{volume.Name}</span>{" "}
									{volume.protected && (
										<Badge variant="outline" className="ml-1.5 text-muted-foreground">
											<Lock className="mr-1 size-3" />
											protected
										</Badge>
									)}
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">{volume.Driver}</TableCell>
								<TableCell className="max-w-72 truncate font-mono text-xs text-muted-foreground">
									{volume.Mountpoint}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											aria-label={`Browse files in ${volume.Name}`}
											onClick={() => setBrowsing(volume)}
										>
											<FolderOpen className="size-3.5" />
											Browse
										</Button>
										{!volume.protected && (
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Remove volume ${volume.Name}`}
												title="Remove volume"
												onClick={() => setRemoving(volume)}
											>
												<Trash2 className="size-3.5 text-destructive" />
											</Button>
										)}
									</div>
								</TableCell>
							</TableRow>
						))}
						{volumes.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
									No volumes on this server.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</TableCard>

			<VolumeBrowserSheet
				volume={browsing}
				serverId={serverId}
				onOpenChange={(open) => !open && setBrowsing(null)}
			/>

			<AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove volume</AlertDialogTitle>
						<AlertDialogDescription>
							Remove volume <span className="font-mono">{removing?.Name}</span>?{" "}
							<strong className="text-foreground">All data in it is permanently lost.</strong>{" "}
							Docker will refuse if a container still uses it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeMutation.isPending}
							onClick={() => {
								if (removing) removeMutation.mutate({ serverId, name: removing.Name });
							}}
						>
							{removeMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={pruneOpen} onOpenChange={setPruneOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Prune unused volumes</AlertDialogTitle>
						<AlertDialogDescription>
							Remove every volume not referenced by any container (including named volumes).
							Platform volumes such as <span className="font-mono">nixploy-postgres-data</span> are
							kept.{" "}
							<strong className="text-foreground">
								Data in orphaned volumes is permanently lost.
							</strong>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={pruneMutation.isPending}
							onClick={() => pruneMutation.mutate({ serverId })}
						>
							{pruneMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Prune
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

/** `12.3 KB` / `4 B` — sizes in a file list, not a dashboard. */
function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Join a directory and an entry name into the path the API expects. */
const joinPath = (directory: string, name: string): string =>
	directory === "/data" ? `/data/${name}` : `${directory}/${name}`;

/** Parent of a `/data/...` path, clamped at the volume root. */
function parentPath(path: string): string {
	const cut = path.lastIndexOf("/");
	return cut <= "/data".length - 1 ? "/data" : path.slice(0, cut);
}

const ENTRY_ICON = {
	directory: Folder,
	symlink: Link2,
	file: FileIcon,
	other: FileIcon,
} as const;

/**
 * File browser for one volume (product audit, Platform row "volume/file
 * browser"). Every call runs a throwaway `alpine` container with the volume
 * mounted — nothing is mounted into the panel — and the server confines every
 * path to the mount; see `modules/docker/volume-files.ts`.
 *
 * Deliberately modest: list, view/edit text files up to 512 KiB, new folder,
 * delete. No upload and no download — those are `volumeBackup`'s job, and a
 * browser that streams gigabytes through a websocket is a different feature.
 */
function VolumeBrowserSheet({
	volume,
	serverId,
	onOpenChange,
}: {
	volume: VolumeRow | null;
	serverId: string | null | undefined;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [path, setPath] = useState("/data");
	// The open file is a lazy query keyed by its path, not local state: a save
	// invalidates it and the editor picks the stored content back up.
	const [openPath, setOpenPath] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [deleting, setDeleting] = useState<{ path: string; name: string } | null>(null);
	const [newFolder, setNewFolder] = useState("");
	const volumeName = volume?.Name ?? "";

	const listInput = { volumeName, serverId, path };
	const listQuery = useQuery({
		...trpc.volumeFiles.list.queryOptions(listInput),
		enabled: Boolean(volume),
		retry: false,
	});

	const invalidateList = () =>
		queryClient.invalidateQueries({ queryKey: trpc.volumeFiles.list.pathKey() });

	const fileQuery = useQuery({
		...trpc.volumeFiles.read.queryOptions({ volumeName, serverId, path: openPath ?? "/data" }),
		enabled: Boolean(volume && openPath),
		retry: false,
	});
	const loadedContent = fileQuery.data?.content;
	useEffect(() => {
		if (loadedContent !== undefined) setDraft(loadedContent);
	}, [loadedContent]);

	const write = useSaveMutation(trpc.volumeFiles.write.mutationOptions(), {
		successMessage: "File saved",
		onSuccess: () => {
			setOpenPath(null);
			invalidateList();
		},
	});
	const remove = useSaveMutation(trpc.volumeFiles.delete.mutationOptions(), {
		successMessage: "Deleted",
		onSuccess: () => {
			setDeleting(null);
			invalidateList();
		},
	});
	const mkdir = useSaveMutation(trpc.volumeFiles.mkdir.mutationOptions(), {
		successMessage: "Folder created",
		onSuccess: () => {
			setNewFolder("");
			invalidateList();
		},
	});

	const close = (open: boolean) => {
		if (!open) {
			setPath("/data");
			setOpenPath(null);
			setNewFolder("");
		}
		onOpenChange(open);
	};

	const crumbs = path.split("/").filter(Boolean).slice(1);
	const entries = listQuery.data?.entries ?? [];

	return (
		<Sheet open={volume !== null} onOpenChange={close}>
			<SheetContent side="right" className="w-full sm:max-w-2xl">
				<SheetHeader>
					<SheetTitle className="font-mono text-sm">{volumeName}</SheetTitle>
					<SheetDescription>
						Files inside the volume, read through a throwaway container. Text files up to 512 KiB
						can be edited here; everything else needs a volume backup.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
					<nav className="flex flex-wrap items-center gap-0.5 text-xs" aria-label="Breadcrumb">
						<button
							type="button"
							className="rounded px-1.5 py-0.5 font-mono hover:bg-secondary"
							onClick={() => setPath("/data")}
						>
							/
						</button>
						{crumbs.map((crumb, index) => {
							const target = `/data/${crumbs.slice(0, index + 1).join("/")}`;
							return (
								<span key={target} className="flex items-center gap-0.5">
									<ChevronRight className="size-3 text-muted-foreground" />
									<button
										type="button"
										className="rounded px-1.5 py-0.5 font-mono hover:bg-secondary"
										onClick={() => setPath(target)}
									>
										{crumb}
									</button>
								</span>
							);
						})}
					</nav>

					{openPath ? (
						<div className="flex min-h-0 flex-1 flex-col gap-2">
							<div className="flex items-center justify-between gap-2">
								<p className="truncate font-mono text-xs text-muted-foreground">{openPath}</p>
								<div className="flex items-center gap-2">
									<Button variant="ghost" size="sm" onClick={() => setOpenPath(null)}>
										Back to files
									</Button>
									<Button
										size="sm"
										disabled={
											write.isPending || fileQuery.isPending || draft === fileQuery.data?.content
										}
										onClick={() =>
											write.mutate({ volumeName, serverId, path: openPath, content: draft })
										}
									>
										{write.isPending ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Save className="size-4" />
										)}
										Save
									</Button>
								</div>
							</div>
							<QueryState
								isPending={fileQuery.isPending}
								isError={fileQuery.isError}
								error={fileQuery.error}
								onRetry={() => fileQuery.refetch()}
								skeleton={<Skeleton className="min-h-64 flex-1 rounded-lg" />}
								// An empty file is a legitimate file, not an empty state.
								isEmpty={false}
								empty={null}
							>
								<CodeEditor
									className="min-h-0 flex-1 overflow-auto rounded-lg border"
									value={draft}
									onChange={setDraft}
									lockMessage="Locked so a stray keystroke cannot change a live volume."
								/>
							</QueryState>
						</div>
					) : (
						<>
							<div className="flex items-center gap-2">
								<Input
									value={newFolder}
									placeholder="New folder name"
									className="h-8 text-xs"
									onChange={(event) => setNewFolder(event.target.value)}
								/>
								<Button
									variant="outline"
									size="sm"
									disabled={!newFolder.trim() || mkdir.isPending}
									onClick={() =>
										mkdir.mutate({
											volumeName,
											serverId,
											path: joinPath(path, newFolder.trim()),
										})
									}
								>
									{mkdir.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<FolderPlus className="size-4" />
									)}
									Create
								</Button>
							</div>

							<QueryState
								isPending={listQuery.isPending}
								isError={listQuery.isError}
								error={listQuery.error}
								onRetry={() => listQuery.refetch()}
								isEmpty={entries.length === 0}
								skeleton={
									<div className="flex flex-col gap-2">
										{["sk-a", "sk-b", "sk-c"].map((id) => (
											<Skeleton key={id} className="h-8 w-full" />
										))}
									</div>
								}
								empty={
									<div className="flex flex-col items-center gap-2 py-10 text-center">
										<Folder className="size-8 text-muted-foreground" />
										<p className="text-sm text-muted-foreground">This folder is empty.</p>
									</div>
								}
							>
								<ul className="min-h-0 flex-1 divide-y overflow-y-auto rounded-lg border">
									{path !== "/data" && (
										<li>
											<button
												type="button"
												className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/50"
												onClick={() => setPath(parentPath(path))}
											>
												<Folder className="size-4 text-muted-foreground" />
												<span className="font-mono">..</span>
											</button>
										</li>
									)}
									{entries.map((entry) => {
										const Icon = ENTRY_ICON[entry.type] ?? FileIcon;
										const full = joinPath(path, entry.name);
										return (
											<li key={entry.name} className="flex items-center gap-2 pr-2">
												<button
													type="button"
													className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/50 disabled:cursor-default disabled:opacity-60"
													disabled={entry.type === "other"}
													onClick={() => {
														if (entry.type === "directory") {
															setPath(full);
															return;
														}
														setDraft("");
														setOpenPath(full);
													}}
												>
													<Icon className="size-4 shrink-0 text-muted-foreground" />
													<span className="truncate font-mono">{entry.name}</span>
													{entry.type !== "directory" && (
														<span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
															{formatSize(entry.size)}
														</span>
													)}
												</button>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Delete ${entry.name}`}
													title="Delete"
													onClick={() => setDeleting({ path: full, name: entry.name })}
												>
													<Trash2 className="size-3.5 text-destructive" />
												</Button>
											</li>
										);
									})}
								</ul>
								{listQuery.data?.truncated && (
									<p className="text-xs text-muted-foreground">
										Only the first 1000 entries are shown.
									</p>
								)}
							</QueryState>
						</>
					)}
				</div>
			</SheetContent>

			<AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							<span className="font-mono">{deleting?.path}</span> is removed from the volume — a
							folder together with everything inside it.{" "}
							<strong className="text-foreground">This cannot be undone.</strong>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (deleting) remove.mutate({ volumeName, serverId, path: deleting.path });
							}}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Sheet>
	);
}
