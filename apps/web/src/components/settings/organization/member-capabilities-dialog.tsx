"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Switch } from "@/components/ui/switch";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

type CatalogEntry = {
	id: string;
	group: string;
	label: string;
	description: string;
};

/** Compact per-member permission editor — labels only, role as the baseline. */
export function MemberCapabilitiesDialog({
	memberId,
	memberName,
	memberRole,
}: {
	memberId: string;
	memberName: string;
	/** Live role from the members list — keeps the matrix in sync after role changes. */
	memberRole: string;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [enabled, setEnabled] = useState<Record<string, boolean>>({});

	const catalogQuery = useQuery({
		...trpc.organization.capabilityCatalog.queryOptions(),
		enabled: open,
	});
	const capsQuery = useQuery({
		...trpc.organization.memberCapabilities.queryOptions({ memberId }),
		enabled: open,
		refetchOnMount: "always",
		staleTime: 0,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: memberRole must retrigger refetch when the select changes
	useEffect(() => {
		if (!open) return;
		void queryClient.invalidateQueries({
			queryKey: trpc.organization.memberCapabilities.queryKey({ memberId }),
		});
	}, [memberRole, memberId, open, queryClient, trpc.organization.memberCapabilities]);

	useEffect(() => {
		if (!capsQuery.data || !catalogQuery.data) return;
		if (capsQuery.isFetching && capsQuery.data.role !== memberRole) return;
		const next: Record<string, boolean> = {};
		for (const cap of catalogQuery.data.capabilities) {
			next[cap] = capsQuery.data.effective.includes(cap);
		}
		setEnabled(next);
	}, [capsQuery.data, capsQuery.isFetching, catalogQuery.data, memberRole]);

	const saveMutation = useMutation(
		trpc.organization.setMemberCapabilities.mutationOptions({
			onSuccess: async () => {
				toast.success("Permissions updated");
				await queryClient.invalidateQueries({
					queryKey: trpc.organization.memberCapabilities.queryKey({ memberId }),
				});
				setOpen(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const defaults = useMemo(
		() => new Set<string>(capsQuery.data?.defaults ?? []),
		[capsQuery.data?.defaults],
	);

	const catalog = (catalogQuery.data?.catalog ?? []) as CatalogEntry[];
	const groups = useMemo(() => {
		const order = catalogQuery.data?.groups ?? [];
		const byGroup = new Map<string, CatalogEntry[]>();
		for (const entry of catalog) {
			const list = byGroup.get(entry.group) ?? [];
			list.push(entry);
			byGroup.set(entry.group, list);
		}
		return order
			.map((group) => ({ group, entries: byGroup.get(group) ?? [] }))
			.filter((row) => row.entries.length > 0);
	}, [catalog, catalogQuery.data?.groups]);

	const dirtyCount = useMemo(() => {
		let count = 0;
		for (const [cap, on] of Object.entries(enabled)) {
			if (on !== defaults.has(cap)) count += 1;
		}
		return count;
	}, [enabled, defaults]);

	const displayedRole = capsQuery.data?.role ?? memberRole;

	const handleSave = () => {
		const grant: string[] = [];
		const revoke: string[] = [];
		for (const [cap, on] of Object.entries(enabled)) {
			const inDefault = defaults.has(cap);
			if (on && !inDefault) grant.push(cap);
			if (!on && inDefault) revoke.push(cap);
		}
		saveMutation.mutate({
			memberId,
			grant: grant as never[],
			revoke: revoke as never[],
		});
	};

	const resetToRole = () => {
		const next: Record<string, boolean> = {};
		for (const entry of catalog) {
			next[entry.id] = defaults.has(entry.id);
		}
		setEnabled(next);
	};

	const isLoading =
		capsQuery.isPending || catalogQuery.isPending || (capsQuery.isFetching && !capsQuery.data);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="ghost" size="icon" className="size-8">
					<Shield className="size-3.5" />
					<span className="sr-only">Permissions</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[min(85vh,40rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogHeader className="gap-1 border-b px-5 py-4 text-left">
					<DialogTitle className="text-base">Permissions</DialogTitle>
					<DialogDescription className="text-sm">
						{memberName}
						{displayedRole ? (
							<>
								{" · "}
								<span className="capitalize text-foreground">{displayedRole}</span>
							</>
						) : null}
					</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="flex justify-center py-14">
						<Loader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : capsQuery.isError ? (
					<p className="px-5 py-8 text-sm text-muted-foreground">{capsQuery.error.message}</p>
				) : (
					<div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
						{groups.map(({ group, entries }) => (
							<section key={group}>
								<h3 className="mb-2 text-xs font-medium text-muted-foreground">{group}</h3>
								<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
									{entries.map((entry) => {
										const fromRole = defaults.has(entry.id);
										const on = Boolean(enabled[entry.id]);
										const customized = on !== fromRole;
										return (
											<li
												key={entry.id}
												className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
											>
												<div className="min-w-0">
													<p className="truncate text-sm">{entry.label}</p>
													{customized ? (
														<p className="text-[11px] text-muted-foreground">
															{on ? "Added" : "Removed"} vs role
														</p>
													) : null}
												</div>
												<Switch
													checked={on}
													onCheckedChange={(value) =>
														setEnabled((current) => ({
															...current,
															[entry.id]: value,
														}))
													}
													aria-label={entry.label}
													className={cn(customized && "data-[state=checked]:bg-amber-600")}
												/>
											</li>
										);
									})}
								</ul>
							</section>
						))}
					</div>
				)}

				<DialogFooter className="gap-2 border-t px-5 py-3 sm:justify-between">
					{dirtyCount > 0 ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={saveMutation.isPending || isLoading}
							onClick={resetToRole}
							className="text-muted-foreground"
						>
							<RotateCcw className="size-3.5" />
							Reset
						</Button>
					) : (
						<span className="text-xs text-muted-foreground">Same as role</span>
					)}
					<div className="flex gap-2">
						<Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={handleSave}
							disabled={saveMutation.isPending || isLoading || dirtyCount === 0}
						>
							{saveMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
