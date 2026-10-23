"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { TraefikParent } from "./traefik-parent";
import type { RedirectEntry } from "./types";

const EMPTY_FORM = { regex: "", replacement: "", permanent: false };

/**
 * Regex redirects for an application or for one service of a compose stack —
 * the same rows, the same Traefik `redirectRegex` middleware, only the parent
 * differs (see `TraefikParent`).
 */
export function RedirectsManager(parent: TraefikParent) {
	const { applicationId, composeId, serviceName } = parent;
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const canWrite = can("service.write");
	const writeHint = canWrite ? undefined : capabilityHint("service.write");

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

	const queryOptions = applicationId
		? trpc.redirect.byApplication.queryOptions({ applicationId })
		: trpc.redirect.byCompose.queryOptions({
				composeId: composeId as string,
				serviceName: serviceName as string,
			});
	const { data: redirects, isLoading, isError, error, refetch } = useQuery(queryOptions);

	const invalidate = [
		applicationId
			? trpc.redirect.byApplication.queryKey({ applicationId })
			: trpc.redirect.byCompose.queryKey({
					composeId: composeId as string,
					serviceName: serviceName as string,
				}),
	];

	const create = useSaveMutation(
		trpc.redirect.create.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Redirect created", invalidate },
	);
	const update = useSaveMutation(
		trpc.redirect.update.mutationOptions({ onSuccess: () => setDialogOpen(false) }),
		{ successMessage: "Redirect updated", invalidate },
	);
	const remove = useSaveMutation(
		trpc.redirect.delete.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Redirect deleted", invalidate },
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
		} else if (applicationId) {
			create.mutate({ applicationId, ...form });
		} else {
			create.mutate({ composeId: composeId as string, serviceName, ...form });
		}
	};

	return (
		<>
			<SettingsSection
				wide
				title="Redirects"
				description={
					serviceName
						? `Regex-based URL redirects applied at the reverse proxy for ${serviceName}.`
						: "Regex-based URL redirects applied at the reverse proxy."
				}
				actions={
					<Button
						size="sm"
						onClick={() => setDialogOpen(true)}
						disabled={!canWrite}
						title={writeHint}
					>
						<Plus className="size-4" />
						Add redirect
					</Button>
				}
			>
				<QueryState
					isPending={isLoading}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!redirects || redirects.length === 0}
					skeleton={
						<div className="flex flex-col gap-2">
							{Array.from({ length: 2 }).map((_, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
								<Skeleton key={i} className="h-10 w-full" />
							))}
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 py-10 text-center">
							<ArrowRightLeft className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">No redirects configured.</p>
						</div>
					}
				>
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
							{(redirects ?? []).map((redirect) => (
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
												disabled={!canWrite}
												title={writeHint}
												onClick={() => openEdit(redirect)}
											>
												<Pencil className="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												aria-label="Delete"
												disabled={!canWrite}
												title={writeHint}
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
				</QueryState>
			</SettingsSection>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editing ? "Edit redirect" : "Add redirect"}</DialogTitle>
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
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open (with its spinner) until the mutation settles.
								event.preventDefault();
								if (deleteTarget) remove.mutate({ redirectId: deleteTarget.redirectId });
							}}
							disabled={remove.isPending}
						>
							{remove.isPending && <Loader2 className="size-4 animate-spin" />}
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
