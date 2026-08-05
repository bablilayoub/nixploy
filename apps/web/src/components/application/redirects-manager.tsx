"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
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

import type { RedirectEntry } from "./types";

const EMPTY_FORM = { regex: "", replacement: "", permanent: false };

export function RedirectsManager({ applicationId }: { applicationId: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<RedirectEntry | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [deleteTarget, setDeleteTarget] = useState<RedirectEntry | null>(null);

	useEffect(() => {
		if (!dialogOpen) {
			setEditing(null);
			setForm(EMPTY_FORM);
		}
	}, [dialogOpen]);

	const { data: redirects, isLoading } = useQuery(
		trpc.redirect.byApplication.queryOptions({ applicationId }),
	);

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.redirect.byApplication.queryKey({ applicationId }),
		});

	const create = useMutation(
		trpc.redirect.create.mutationOptions({
			onSuccess: () => {
				toast.success("Redirect created");
				setDialogOpen(false);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const update = useMutation(
		trpc.redirect.update.mutationOptions({
			onSuccess: () => {
				toast.success("Redirect updated");
				setDialogOpen(false);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const remove = useMutation(
		trpc.redirect.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Redirect deleted");
				setDeleteTarget(null);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const isPending = create.isPending || update.isPending;
	const isValid = form.regex.trim() !== "" && form.replacement.trim() !== "";

	const openEdit = (redirect: RedirectEntry) => {
		setEditing(redirect);
		setForm({
			regex: redirect.regex,
			replacement: redirect.replacement,
			permanent: redirect.permanent,
		});
		setDialogOpen(true);
	};

	const onSubmit = () => {
		if (editing) {
			update.mutate({ redirectId: editing.redirectId, ...form });
		} else {
			create.mutate({ applicationId, ...form });
		}
	};

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0">
				<div className="flex flex-col gap-1.5">
					<CardTitle className="text-sm font-medium">Redirects</CardTitle>
					<CardDescription>Regex-based URL redirects applied at the reverse proxy.</CardDescription>
				</div>
				<Button size="sm" onClick={() => setDialogOpen(true)}>
					<Plus className="size-4" />
					Add Redirect
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
				) : !redirects || redirects.length === 0 ? (
					<div className="flex flex-col items-center gap-2 py-10 text-center">
						<ArrowRightLeft className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No redirects configured.</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Regex</TableHead>
								<TableHead>Replacement</TableHead>
								<TableHead>Type</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{redirects.map((redirect) => (
								<TableRow key={redirect.redirectId}>
									<TableCell className="max-w-56 truncate font-mono text-xs">
										{redirect.regex}
									</TableCell>
									<TableCell className="max-w-56 truncate font-mono text-xs">
										{redirect.replacement}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{redirect.permanent ? "301 Permanent" : "302 Temporary"}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label="Edit"
												onClick={() => openEdit(redirect)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete"
												onClick={() => setDeleteTarget(redirect)}
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
						<DialogTitle>{editing ? "Edit Redirect" : "Add Redirect"}</DialogTitle>
						<DialogDescription>
							Example: regex <code className="rounded bg-muted px-1">^/old/(.*)$</code> →{" "}
							<code className="rounded bg-muted px-1">/new/$1</code>
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
							<Label htmlFor="regex">Regex</Label>
							<Input
								id="regex"
								className="font-mono text-sm"
								placeholder="^/old/(.*)$"
								value={form.regex}
								onChange={(e) => setForm((f) => ({ ...f, regex: e.target.value }))}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="replacement">Replacement</Label>
							<Input
								id="replacement"
								className="font-mono text-sm"
								placeholder="/new/$1"
								value={form.replacement}
								onChange={(e) => setForm((f) => ({ ...f, replacement: e.target.value }))}
							/>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox
								id="permanent"
								checked={form.permanent}
								onCheckedChange={(checked) =>
									setForm((f) => ({ ...f, permanent: checked === true }))
								}
							/>
							<Label htmlFor="permanent" className="font-normal">
								Permanent redirect (301)
							</Label>
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
						<AlertDialogTitle>Delete redirect?</AlertDialogTitle>
						<AlertDialogDescription>
							Requests matching <code className="rounded bg-muted px-1">{deleteTarget?.regex}</code>{" "}
							will no longer be redirected.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteTarget && remove.mutate({ redirectId: deleteTarget.redirectId })}
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
