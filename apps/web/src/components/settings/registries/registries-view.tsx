"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Database, Loader2, Pencil, Plug, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageHeader } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type RegistryRow = inferRouterOutputs<AppRouter>["registry"]["all"][number];

export function RegistriesView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const { can } = useCapabilities();
	const canManage = can("registries.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("registries.manage");
	const [registryName, setRegistryName] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [registryUrl, setRegistryUrl] = useState("");
	const [registryType, setRegistryType] = useState<"cloud" | "selfHosted">("cloud");
	const [imagePrefix, setImagePrefix] = useState("");

	const {
		data: registries,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.registry.all.queryOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: trpc.registry.all.queryKey() });

	const createMutation = useMutation(
		trpc.registry.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Registry added");
				await invalidate();
				setOpen(false);
				setRegistryName("");
				setUsername("");
				setPassword("");
				setRegistryUrl("");
				setRegistryType("cloud");
				setImagePrefix("");
			},
			onError: (error) => toastError(error),
		}),
	);

	const testMutation = useMutation(
		trpc.registry.test.mutationOptions({
			onSuccess: () => toast.success("Registry login successful"),
			onError: (error) => toastError(error),
		}),
	);

	const removeMutation = useMutation(
		trpc.registry.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("Registry removed");
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	const [editing, setEditing] = useState<RegistryRow | null>(null);
	const [editName, setEditName] = useState("");
	const [editUsername, setEditUsername] = useState("");
	const [editPassword, setEditPassword] = useState("");
	const [editUrl, setEditUrl] = useState("");
	const [editType, setEditType] = useState<"cloud" | "selfHosted">("cloud");
	const [editPrefix, setEditPrefix] = useState("");

	useEffect(() => {
		if (editing) {
			setEditName(editing.registryName);
			setEditUsername(editing.username);
			setEditPassword("");
			setEditUrl(editing.registryUrl ?? "");
			setEditType(editing.registryType);
			setEditPrefix(editing.imagePrefix ?? "");
		}
	}, [editing]);

	const updateMutation = useMutation(
		trpc.registry.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Registry updated");
				await invalidate();
				setEditing(null);
			},
			onError: (error) => toastError(error),
		}),
	);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Registries"
				description="Credentials for private registries (Hub, GHCR, or your own)."
			/>
			<SettingsSection
				title={
					<span className="flex items-center gap-2">
						<Database className="size-4 text-muted-foreground" />
						Registries
					</span>
				}
				description="Encrypted usernames and passwords. Attach on an app’s source for private images."
				actions={
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canManage} title={manageHint}>
								<Plus className="size-4" />
								Add Registry
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add registry</DialogTitle>
								<DialogDescription>Store credentials for a Docker registry.</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="registry-name">Name</Label>
									<Input
										id="registry-name"
										placeholder="e.g. Docker Hub"
										value={registryName}
										onChange={(e) => setRegistryName(e.target.value)}
									/>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div className="grid gap-2">
										<Label htmlFor="registry-username">Username</Label>
										<Input
											id="registry-username"
											value={username}
											onChange={(e) => setUsername(e.target.value)}
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="registry-password">Password</Label>
										<Input
											id="registry-password"
											type="password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
										/>
									</div>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="registry-url">Registry URL (optional)</Label>
									<Input
										id="registry-url"
										placeholder="https://index.docker.io/v1"
										value={registryUrl}
										onChange={(e) => setRegistryUrl(e.target.value)}
									/>
								</div>
								<div className="grid grid-cols-2 gap-4">
									<div className="grid gap-2">
										<Label>Type</Label>
										<Select
											value={registryType}
											onValueChange={(value) => setRegistryType(value as "cloud" | "selfHosted")}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="cloud">Cloud</SelectItem>
												<SelectItem value="selfHosted">Self-hosted</SelectItem>
											</SelectContent>
										</Select>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="registry-prefix">Image prefix (optional)</Label>
										<Input
											id="registry-prefix"
											value={imagePrefix}
											onChange={(e) => setImagePrefix(e.target.value)}
										/>
									</div>
								</div>
							</div>
							<DialogFooter>
								<Button
									disabled={createMutation.isPending || !registryName || !username || !password}
									onClick={() =>
										createMutation.mutate({
											registryName,
											username,
											password,
											registryUrl: registryUrl || undefined,
											registryType,
											imagePrefix: imagePrefix || undefined,
										})
									}
								>
									{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
									Add registry
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
					isEmpty={!registries || registries.length === 0}
					skeleton={
						<div className="grid gap-2">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
							<Database className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No registries yet. Add credentials for Docker Hub, GHCR, or a private registry to
								pull (and push) private images.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Username</TableHead>
								<TableHead>URL</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-24 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(registries ?? []).map((registry) => (
								<TableRow key={registry.registryId}>
									<TableCell className="font-medium">{registry.registryName}</TableCell>
									<TableCell className="text-muted-foreground">{registry.username}</TableCell>
									<TableCell className="max-w-40 truncate text-muted-foreground">
										{registry.registryUrl || "—"}
									</TableCell>
									<TableCell>
										<Badge variant="secondary">
											{registry.registryType === "selfHosted" ? "Self-hosted" : "Cloud"}
										</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{format(new Date(registry.createdAt), "MMM d, yyyy")}
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
														testMutation.variables?.registryId === registry.registryId)
												}
												onClick={() =>
													testMutation.mutate({
														registryId: registry.registryId,
													})
												}
											>
												{testMutation.isPending &&
												testMutation.variables?.registryId === registry.registryId ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Plug className="size-4" />
												)}
												<span className="sr-only">Test registry</span>
											</Button>
											<Button
												variant="ghost"
												size="icon"
												disabled={!canManage}
												title={manageHint}
												onClick={() => setEditing(registry)}
											>
												<Pencil className="size-4" />
												<span className="sr-only">Edit registry</span>
											</Button>
											<ConfirmDeleteDialog
												title="Remove registry"
												description={`Remove "${registry.registryName}"? Builds and pulls using it will fail.`}
												disabled={!canManage}
												disabledReason={manageHint}
												onConfirm={() =>
													removeMutation.mutateAsync({
														registryId: registry.registryId,
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
			<Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Edit registry</DialogTitle>
						<DialogDescription>
							Update the registry credentials. Leave the password blank to keep the current one.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (editing) {
								updateMutation.mutate({
									registryId: editing.registryId,
									registryName: editName.trim(),
									username: editUsername.trim(),
									...(editPassword ? { password: editPassword } : {}),
									registryUrl: editUrl.trim(),
									registryType: editType,
									imagePrefix: editPrefix || null,
								});
							}
						}}
						className="grid gap-4"
					>
						<div className="grid gap-2">
							<Label htmlFor="edit-registry-name">Name</Label>
							<Input
								id="edit-registry-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label htmlFor="edit-registry-username">Username</Label>
								<Input
									id="edit-registry-username"
									value={editUsername}
									onChange={(e) => setEditUsername(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-registry-password">Password</Label>
								<Input
									id="edit-registry-password"
									type="password"
									placeholder="Leave blank to keep current"
									value={editPassword}
									onChange={(e) => setEditPassword(e.target.value)}
								/>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="edit-registry-url">Registry URL (optional)</Label>
							<Input
								id="edit-registry-url"
								placeholder="https://index.docker.io/v1"
								value={editUrl}
								onChange={(e) => setEditUrl(e.target.value)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label>Type</Label>
								<Select
									value={editType}
									onValueChange={(value) => setEditType(value as "cloud" | "selfHosted")}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="cloud">Cloud</SelectItem>
										<SelectItem value="selfHosted">Self-hosted</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="edit-registry-prefix">Image prefix (optional)</Label>
								<Input
									id="edit-registry-prefix"
									value={editPrefix}
									onChange={(e) => setEditPrefix(e.target.value)}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								type="submit"
								disabled={updateMutation.isPending || !editName.trim() || !editUsername.trim()}
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
