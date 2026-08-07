"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { useTRPC } from "@/lib/trpc";
import type { ServiceEntry } from "./services-table";

/** Assign org tags to one service. */
export function ServiceTagsDialog({
	service,
	open,
	onOpenChange,
}: {
	service: ServiceEntry;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const tagsQuery = useQuery({
		...trpc.tag.all.queryOptions(),
		enabled: open,
	});

	useEffect(() => {
		if (!open) return;
		setSelected(new Set(service.tags?.map((tag) => tag.tagId) ?? []));
	}, [open, service.tags]);

	const saveMutation = useMutation(
		trpc.tag.setServiceTags.mutationOptions({
			onSuccess: async () => {
				toast.success("Tags updated");
				await queryClient.invalidateQueries({ queryKey: trpc.tag.forServices.queryKey() });
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const toggle = (tagId: string, checked: boolean) => {
		setSelected((previous) => {
			const next = new Set(previous);
			if (checked) next.add(tagId);
			else next.delete(tagId);
			return next;
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Tags for {service.name}</DialogTitle>
					<DialogDescription>Select tags to assign to this service.</DialogDescription>
				</DialogHeader>
				{(tagsQuery.data ?? []).length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No tags yet — create some with the Tags button on the project page.
					</p>
				) : (
					<ul className="max-h-56 space-y-2 overflow-y-auto">
						{(tagsQuery.data ?? []).map((tag) => (
							<li key={tag.tagId} className="flex items-center gap-2">
								<Checkbox
									id={`svc-tag-${tag.tagId}`}
									checked={selected.has(tag.tagId)}
									onCheckedChange={(checked) => toggle(tag.tagId, checked === true)}
								/>
								<label
									htmlFor={`svc-tag-${tag.tagId}`}
									className="flex cursor-pointer items-center gap-2 text-sm"
								>
									<span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
									{tag.name}
								</label>
							</li>
						))}
					</ul>
				)}
				<DialogFooter>
					<Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={saveMutation.isPending || (tagsQuery.data?.length ?? 0) === 0}
						onClick={() =>
							saveMutation.mutate({
								type: service.type,
								serviceId: service.id,
								tagIds: [...selected],
							})
						}
					>
						{saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
