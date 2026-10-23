"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import { Database, Loader2, Pencil, Plug, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { QueryState } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { TableNoMatch, TablePagination, TableSearch } from "@/components/ui/table-toolbar";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTableView } from "@/hooks/use-table-view";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type RegistryRow = inferRouterOutputs<AppRouter>["registry"]["all"][number];

export function RegistriesView() {
	const trpc = useTRPC();
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

	const view = useTableView({
		rows: registries ?? [],
		search: (row) => [row.registryName, row.username, row.registryUrl, row.registryType],
	});

	const listKey = trpc.registry.all.queryKey();

	const createMutation = useSaveMutation(trpc.registry.create.mutationOptions(), {
		successMessage: "Registry added",
		invalidate: [listKey],
		onSuccess: () => {
			setOpen(false);
			setRegistryName("");
			setUsername("");
			setPassword("");
			setRegistryUrl("");
			setRegistryType("cloud");
			setImagePrefix("");
		},
	});

	const testMutation = useSaveMutation(trpc.registry.test.mutationOptions(), {
		successMessage: "Registry login successful",
	});

	const removeMutation = useSaveMutation(trpc.registry.remove.mutationOptions(), {
		successMessage: "Registry removed",
		invalidate: [listKey],
	});

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

	const updateMutation = useSaveMutation(trpc.registry.update.mutationOptions(), {
		successMessage: "Registry updated",
		invalidate: [listKey],
		onSuccess: () => setEditing(null),
	});

	return (
		<div className="flex min-w-0 flex-col gap-7">
			<PageHeader
				title="Registries"
				description="Credentials for private registries (Hub, GHCR, or your own)."
				actions={
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canManage} title={manageHint}>
								<Plus className="size-4" />
								Add registry
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add registry</DialogTitle>
								<DialogDescription>Store credentials for a Docker registry.</DialogDescription>
							</DialogHeader>
							<div className="grid gap-5">
								<Field>
									<FieldLabel htmlFor="registry-name">Name</FieldLabel>
									<Input
										id="registry-name"
										placeholder="e.g. Docker Hub"
										value={registryName}
										onChange={(e) => setRegistryName(e.target.value)}
									/>
								</Field>
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<Field>
										<FieldLabel htmlFor="registry-username">Username</FieldLabel>
										<Input
											id="registry-username"
											value={username}
											onChange={(e) => setUsername(e.target.value)}
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="registry-password">Password</FieldLabel>
										<Input
											id="registry-password"
											type="password"
											value={password}
											onChange={(e) => setPassword(e.target.value)}
										/>
									</Field>
								</div>
								<Field>
									<FieldLabel htmlFor="registry-url">Registry URL (optional)</FieldLabel>
									<Input
										id="registry-url"
										placeholder="https://index.docker.io/v1"
										value={registryUrl}
										onChange={(e) => setRegistryUrl(e.target.value)}
									/>
								</Field>
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<Field>
										<FieldLabel>Type</FieldLabel>
										<Select
											value={registryType}
											onValueChange={(value) => setRegistryType(value as "cloud" | "selfHosted")}
										>
											<SelectTrigger aria-label="Type">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="cloud">Cloud</SelectItem>
												<SelectItem value="selfHosted">Self-hosted</SelectItem>
											</SelectContent>
										</Select>
									</Field>
									<Field>
										<FieldLabel htmlFor="registry-prefix">Image prefix (optional)</FieldLabel>
										<Input
											id="registry-prefix"
											value={imagePrefix}
											onChange={(e) => setImagePrefix(e.target.value)}
										/>
									</Field>
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
			/>
			<div className="min-w-0">
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
						<EmptyState
							icon={Database}
							title="No registries"
							description="Add credentials for Docker Hub, GHCR, or a private registry to pull (and push) private images."
						/>
					}
				>
					<TableSearch view={view} placeholder="Search registries…" className="mb-3 ms-auto" />
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
							{view.visible.length === 0 ? <TableNoMatch view={view} colSpan={6} /> : null}
							{view.visible.map((registry) => (
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
					<TablePagination view={view} noun="registries" className="mt-3" />
				</QueryState>
			</div>
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
						className="grid gap-5"
					>
						<Field>
							<FieldLabel htmlFor="edit-registry-name">Name</FieldLabel>
							<Input
								id="edit-registry-name"
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
							/>
						</Field>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Field>
								<FieldLabel htmlFor="edit-registry-username">Username</FieldLabel>
								<Input
									id="edit-registry-username"
									value={editUsername}
									onChange={(e) => setEditUsername(e.target.value)}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="edit-registry-password">Password</FieldLabel>
								<Input
									id="edit-registry-password"
									type="password"
									placeholder="Leave blank to keep current"
									value={editPassword}
									onChange={(e) => setEditPassword(e.target.value)}
								/>
							</Field>
						</div>
						<Field>
							<FieldLabel htmlFor="edit-registry-url">Registry URL (optional)</FieldLabel>
							<Input
								id="edit-registry-url"
								placeholder="https://index.docker.io/v1"
								value={editUrl}
								onChange={(e) => setEditUrl(e.target.value)}
							/>
						</Field>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<Field>
								<FieldLabel>Type</FieldLabel>
								<Select
									value={editType}
									onValueChange={(value) => setEditType(value as "cloud" | "selfHosted")}
								>
									<SelectTrigger aria-label="Type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="cloud">Cloud</SelectItem>
										<SelectItem value="selfHosted">Self-hosted</SelectItem>
									</SelectContent>
								</Select>
							</Field>
							<Field>
								<FieldLabel htmlFor="edit-registry-prefix">Image prefix (optional)</FieldLabel>
								<Input
									id="edit-registry-prefix"
									value={editPrefix}
									onChange={(e) => setEditPrefix(e.target.value)}
								/>
							</Field>
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
