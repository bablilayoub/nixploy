"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { HardDrive, Loader2, Pencil, Plug, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { InstanceBackups } from "@/components/settings/destinations/instance-backups";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCapabilities } from "@/hooks/use-capabilities";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type DestinationRow = inferRouterOutputs<AppRouter>["destination"]["all"][number];

export function DestinationsView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const { can } = useCapabilities();
	const canManage = can("destinations.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("destinations.manage");
	const [name, setName] = useState("");
	const [bucket, setBucket] = useState("");
	const [region, setRegion] = useState("");
	const [endpoint, setEndpoint] = useState("");
	const [accessKey, setAccessKey] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");

	const {
		data: destinations,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.destination.all.queryOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.destination.all.queryKey(),
		});

	const createMutation = useMutation(
		trpc.destination.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Backup destination added");
				await invalidate();
				setOpen(false);
				setName("");
				setBucket("");
				setRegion("");
				setEndpoint("");
				setAccessKey("");
				setSecretAccessKey("");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const testMutation = useMutation(
		trpc.destination.testConnection.mutationOptions({
			onSuccess: () => toast.success("Connection successful"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.destination.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("Backup destination removed");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const [editing, setEditing] = useState<DestinationRow | null>(null);
	const [editName, setEditName] = useState("");
	const [editBucket, setEditBucket] = useState("");
	const [editRegion, setEditRegion] = useState("");
	const [editEndpoint, setEditEndpoint] = useState("");
	const [editAccessKey, setEditAccessKey] = useState("");
	const [editSecretAccessKey, setEditSecretAccessKey] = useState("");

	useEffect(() => {
		if (editing) {
			setEditName(editing.name);
			setEditBucket(editing.bucket);
			setEditRegion(editing.region);
			setEditEndpoint(editing.endpoint);
			setEditAccessKey(editing.accessKey ?? "");
			setEditSecretAccessKey("");
		}
	}, [editing]);

	const updateMutation = useMutation(
		trpc.destination.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Backup destination updated");
				await invalidate();
				setEditing(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Backup storage"
				description="S3-compatible storage for database and volume backups."
			/>
			<SettingsSection
				title={
					<span className="flex items-center gap-2">
						<HardDrive className="size-4 text-muted-foreground" />
						Backup storage
					</span>
				}
				description="S3-compatible buckets used for database and volume backups."
				actions={
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canManage} title={manageHint}>
								<Plus className="size-4" />
								Add backup destination
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add backup destination</DialogTitle>
								<DialogDescription>Connect an S3-compatible bucket for backups.</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="dest-name">Name</Label>
									<Input
										id="dest-name"
										placeholder="e.g. backups-s3"
										value={name}
										onChange={(e) => setName(e.target.value)}
									/>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div className="grid gap-2">
										<Label htmlFor="dest-bucket">Bucket</Label>
										<Input
											id="dest-bucket"
											value={bucket}
											onChange={(e) => setBucket(e.target.value)}
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="dest-region">Region</Label>
										<Input
											id="dest-region"
											placeholder="us-east-1"
											value={region}
											onChange={(e) => setRegion(e.target.value)}
										/>
									</div>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="dest-endpoint">Endpoint</Label>
									<Input
										id="dest-endpoint"
										placeholder="https://s3.us-east-1.amazonaws.com"
										value={endpoint}
										onChange={(e) => setEndpoint(e.target.value)}
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="dest-access-key">Access key ID</Label>
									<Input
										id="dest-access-key"
										value={accessKey}
										onChange={(e) => setAccessKey(e.target.value)}
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="dest-secret-key">Secret access key</Label>
									<Input
										id="dest-secret-key"
										type="password"
										value={secretAccessKey}
										onChange={(e) => setSecretAccessKey(e.target.value)}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									disabled={
										createMutation.isPending ||
										!name ||
										!bucket ||
										!region ||
										!endpoint ||
										!accessKey ||
										!secretAccessKey
									}
									onClick={() =>
										createMutation.mutate({
											name,
											bucket,
											region,
											endpoint,
											accessKey,
											secretAccessKey,
										})
									}
								>
									{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
									Add backup destination
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				}
			>
				<QueryState
					isPending={isPending}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!destinations || destinations.length === 0}
					skeleton={
						<div className="grid gap-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
							<HardDrive className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No backup destinations yet. Add one to enable backups.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Bucket</TableHead>
								<TableHead>Region</TableHead>
								<TableHead>Endpoint</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-24 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(destinations ?? []).map((destination) => (
								<TableRow key={destination.destinationId}>
									<TableCell className="font-medium">{destination.name}</TableCell>
									<TableCell className="text-muted-foreground">{destination.bucket}</TableCell>
									<TableCell className="text-muted-foreground">{destination.region}</TableCell>
									<TableCell className="max-w-48 truncate text-muted-foreground">
										{destination.endpoint}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{format(new Date(destination.createdAt), "MMM d, yyyy")}
									</TableCell>
									<TableCell>
										<div className="flex items-center justify-end">
											<Button
												variant="ghost"
												size="icon"
												title={manageHint}
												disabled={
													!canManage ||
													(testMutation.isPending &&
														testMutation.variables?.destinationId === destination.destinationId)
												}
												onClick={() =>
													testMutation.mutate({
														destinationId: destination.destinationId,
													})
												}
											>
												{testMutation.isPending &&
												testMutation.variables?.destinationId === destination.destinationId ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Plug className="size-4" />
												)}
												<span className="sr-only">Test connection</span>
											</Button>
											<Button
												variant="ghost"
												size="icon"
												disabled={!canManage}
												title={manageHint}
												onClick={() => setEditing(destination)}
											>
												<Pencil className="size-4" />
												<span className="sr-only">Edit destination</span>
											</Button>
											<ConfirmDeleteDialog
												title="Remove destination"
												description={`Remove "${destination.name}"? Backups pointing at it will be deleted too.`}
												disabled={!canManage}
												disabledReason={manageHint}
												onConfirm={() =>
													removeMutation.mutateAsync({
														destinationId: destination.destinationId,
													})
												}
											/>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueryState>
			</SettingsSection>
			<InstanceBackups />
			<Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit destination</DialogTitle>
						<DialogDescription>
							Update the bucket settings. Leave the secret access key blank to keep the current one.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (editing) {
								updateMutation.mutate({
									destinationId: editing.destinationId,
									name: editName.trim(),
									bucket: editBucket.trim(),
									region: editRegion.trim(),
									endpoint: editEndpoint.trim(),
									accessKey: editAccessKey.trim(),
									...(editSecretAccessKey ? { secretAccessKey: editSecretAccessKey } : {}),
								});
							}
						}}
						className="grid gap-4"
					>
						<div className="grid gap-2">
							<Label htmlFor="edit-dest-name">Name</Label>
							<Input
								id="edit-dest-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-dest-bucket">Bucket</Label>
								<Input
									id="edit-dest-bucket"
									value={editBucket}
									onChange={(e) => setEditBucket(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-dest-region">Region</Label>
								<Input
									id="edit-dest-region"
									value={editRegion}
									onChange={(e) => setEditRegion(e.target.value)}
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-dest-endpoint">Endpoint</Label>
							<Input
								id="edit-dest-endpoint"
								value={editEndpoint}
								onChange={(e) => setEditEndpoint(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-dest-access-key">Access key ID</Label>
							<Input
								id="edit-dest-access-key"
								value={editAccessKey}
								onChange={(e) => setEditAccessKey(e.target.value)}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-dest-secret-key">Secret access key</Label>
							<Input
								id="edit-dest-secret-key"
								type="password"
								placeholder="Leave blank to keep current"
								value={editSecretAccessKey}
								onChange={(e) => setEditSecretAccessKey(e.target.value)}
							/>
						</div>
						<DialogFooter>
							<Button
								type="submit"
								disabled={
									updateMutation.isPending ||
									!editName.trim() ||
									!editBucket.trim() ||
									!editRegion.trim() ||
									!editEndpoint.trim() ||
									!editAccessKey.trim()
								}
							>
								{updateMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
