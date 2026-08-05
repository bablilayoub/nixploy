"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import { useTRPC } from "@/lib/trpc";

import type { SecurityEntry } from "./types";

const EMPTY_FORM = { username: "", password: "" };

export function SecurityManager({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<SecurityEntry | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<SecurityEntry | null>(null);

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const { data: entries, isLoading } = useQuery(
		trpc.security.byApplication.queryOptions({ applicationId }),
	);

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.security.byApplication.queryKey({ applicationId }),
		});

	const create = useMutation(
		trpc.security.create.mutationOptions({
			onSuccess: () => {
				toast.success("Credentials created");
				setDialogOpen(false);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const update = useMutation(
		trpc.security.update.mutationOptions({
			onSuccess: () => {
				toast.success("Credentials updated");
				setDialogOpen(false);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.security.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Credentials deleted");
				setDeleteTarget(null);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const isPending = create.isPending || update.isPending;
	const isValid = form.username.trim() !== "" && (editing !== null || form.password.trim() !== "");

	const openEdit = (entry: SecurityEntry) => {
		setEditing(entry);
		setForm({ username: entry.username, password: "" });
		setDialogOpen(true);
	};

	const onSubmit = () => {
		if (editing) {
			update.mutate({
				securityId: editing.securityId,
				username: form.username,
				...(form.password ? { password: form.password } : {}),
			});
		} else {
			create.mutate({
				applicationId,
				username: form.username,
				password: form.password,
			});
		}
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<div className="flex flex-col gap-1.5">
					<CardTitle className="text-sm font-medium">Security</CardTitle>
					<CardDescription>
						Protect the application with HTTP basic auth at the reverse proxy.
					</CardDescription>
				</div>
				<Button size="sm" onClick={() => setDialogOpen(true)}>
					<Plus className="size-4" />
					Add Credentials
				</Button>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex flex-col gap-2">
						{Array.from({ length: 2 }).map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
							<Skeleton key={i} className="h-10 w-full" />
						))}
					</div>
				) : !entries || entries.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-10 text-center">
						<ShieldCheck className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No basic-auth credentials. The application is publicly reachable.
						</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Username</TableHead>
								<TableHead>Password</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{entries.map((entry) => (
								<TableRow key={entry.securityId}>
									<TableCell className="font-medium">{entry.username}</TableCell>
									<TableCell className="text-muted-foreground">••••••••</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit"
												onClick={() => openEdit(entry)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete"
												onClick={() => setDeleteTarget(entry)}
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit Credentials" : "Add Credentials"}</DialogTitle>
						<DialogDescription>
							{editing
								? "Leave the password empty to keep the current one."
								: "Visitors will be asked for these credentials before reaching the app."}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							onSubmit();
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="username">Username</Label>
							<Input
								id="username"
								autoComplete="off"
								value={form.username}
								onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								autoComplete="new-password"
								value={form.password}
								onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={!isValid || isPending}>
								{isPending && <Loader2 className="size-4 animate-spin" />}
								{editing ? "Save" : "Create"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete credentials?</AlertDialogTitle>
						<AlertDialogDescription>
							Basic-auth access for user{" "}
							<span className="font-medium">{deleteTarget?.username}</span> will be removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteTarget && remove.mutate({ securityId: deleteTarget.securityId })}
							disabled={remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
