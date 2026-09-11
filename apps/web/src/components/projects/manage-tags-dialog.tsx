"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Tags, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { capabilityHint } from "@/components/services/capability-hint";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

const DEFAULT_COLOR = "#6366f1";

/** Create / delete org tags from the project services toolbar. */
export function ManageTagsDialog() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { can } = useCapabilities();
	const canManage = can("tags.manage");
	const manageHint = canManage ? undefined : capabilityHint("tags.manage");
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [color, setColor] = useState(DEFAULT_COLOR);
	// One row edits at a time (rename / recolour via tag.update).
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const [editColor, setEditColor] = useState(DEFAULT_COLOR);

	// Deep link from the command palette (?new=tags) opens the dialog once.
	useEffect(() => {
		if (searchParams.get("new") !== "tags") {
			return;
		}
		setOpen(true);
		// Strip the param so a refresh doesn't reopen the dialog.
		const params = new URLSearchParams(searchParams.toString());
		params.delete("new");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
	}, [searchParams, router, pathname]);

	const tagsQuery = useQuery({
		...trpc.tag.all.queryOptions(),
		enabled: open,
	});

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.tag.all.queryKey() });
		await queryClient.invalidateQueries({ queryKey: trpc.tag.forServices.queryKey() });
	};

	const createMutation = useMutation(
		trpc.tag.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Tag created");
				setName("");
				setColor(DEFAULT_COLOR);
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	const updateMutation = useMutation(
		trpc.tag.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Tag updated");
				setEditingId(null);
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	const startEdit = (tag: { tagId: string; name: string; color: string }) => {
		setEditingId(tag.tagId);
		setEditName(tag.name);
		setEditColor(tag.color);
	};

	const deleteMutation = useMutation(
		trpc.tag.delete.mutationOptions({
			onSuccess: async () => {
				toast.success("Tag deleted");
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" size="sm" variant="outline">
					<Tags className="size-4" />
					Tags
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Manage tags</DialogTitle>
					<DialogDescription>
						Organization-wide labels for filtering services. Assign them from a service row menu.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					{(tagsQuery.data ?? []).length === 0 ? (
						<p className="text-sm text-muted-foreground">No tags yet.</p>
					) : (
						<ul className="max-h-48 space-y-2 overflow-y-auto">
							{(tagsQuery.data ?? []).map((tag) =>
								editingId === tag.tagId ? (
									<li key={tag.tagId} className="flex items-center gap-2">
										<input
											type="color"
											aria-label={`Colour of ${tag.name}`}
											value={editColor}
											onChange={(event) => setEditColor(event.target.value)}
											className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
										/>
										<Input
											aria-label={`Rename ${tag.name}`}
											value={editName}
											onChange={(event) => setEditName(event.target.value)}
											className="h-8"
											autoFocus
											onKeyDown={(event) => {
												if (event.key === "Escape") setEditingId(null);
												if (event.key === "Enter" && editName.trim()) {
													event.preventDefault();
													updateMutation.mutate({
														tagId: tag.tagId,
														name: editName.trim(),
														color: editColor,
													});
												}
											}}
										/>
										<Button
											type="button"
											size="icon"
											variant="ghost"
											className="size-8"
											aria-label="Save tag"
											disabled={updateMutation.isPending || editName.trim().length === 0}
											onClick={() =>
												updateMutation.mutate({
													tagId: tag.tagId,
													name: editName.trim(),
													color: editColor,
												})
											}
										>
											{updateMutation.isPending ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Check className="size-4" />
											)}
										</Button>
										<Button
											type="button"
											size="icon"
											variant="ghost"
											className="size-8"
											aria-label="Cancel editing"
											disabled={updateMutation.isPending}
											onClick={() => setEditingId(null)}
										>
											<X className="size-4" />
										</Button>
									</li>
								) : (
									<li key={tag.tagId} className="flex items-center justify-between gap-2">
										<span className="flex items-center gap-2 text-sm">
											<span
												className="size-2.5 rounded-full"
												style={{ backgroundColor: tag.color }}
											/>
											{tag.name}
										</span>
										<span className="flex items-center gap-1">
											<Button
												type="button"
												size="icon"
												variant="ghost"
												className="size-8"
												aria-label={`Edit tag ${tag.name}`}
												disabled={!canManage || updateMutation.isPending}
												title={manageHint}
												onClick={() => startEdit(tag)}
											>
												<Pencil className="size-3.5" />
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												disabled={deleteMutation.isPending || !canManage}
												title={manageHint}
												onClick={() => deleteMutation.mutate({ tagId: tag.tagId })}
											>
												Delete
											</Button>
										</span>
									</li>
								),
							)}
						</ul>
					)}
					<div className="flex flex-col gap-2 border-t pt-3">
						<Label htmlFor="new-tag-name">New tag</Label>
						<div className="flex gap-2">
							<Input
								id="new-tag-name"
								placeholder="Name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								className="h-8"
							/>
							<input
								type="color"
								aria-label="Tag color"
								value={color}
								onChange={(event) => setColor(event.target.value)}
								className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
							/>
							<Button
								type="button"
								size="sm"
								disabled={name.trim().length === 0 || createMutation.isPending || !canManage}
								title={manageHint}
								onClick={() => createMutation.mutate({ name: name.trim(), color })}
							>
								{createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Add"}
							</Button>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button type="button" variant="secondary" onClick={() => setOpen(false)}>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
