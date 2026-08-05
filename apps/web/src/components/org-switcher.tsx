"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

function slugify(name: string) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "org"
	);
}

export function OrgSwitcher() {
	const queryClient = useQueryClient();
	const { data: organizations, isPending } = authClient.useListOrganizations();
	const { data: activeOrganization } = authClient.useActiveOrganization();
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	const active = activeOrganization ?? organizations?.[0] ?? null;

	const switchOrganization = async (organizationId: string) => {
		if (organizationId === active?.id) return;
		try {
			await authClient.organization.setActive({ organizationId });
			// Every tRPC query is scoped to the active organization.
			await queryClient.invalidateQueries();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to switch organization");
		}
	};

	const createOrganization = async () => {
		const trimmed = name.trim();
		if (!trimmed) return;
		setIsCreating(true);
		try {
			const { data, error } = await authClient.organization.create({
				name: trimmed,
				slug: `${slugify(trimmed)}-${Date.now().toString(36)}`,
			});
			if (error) throw new Error(error.message);
			if (data?.id) {
				await authClient.organization.setActive({ organizationId: data.id });
			}
			await queryClient.invalidateQueries();
			toast.success(`Organization "${trimmed}" created`);
			setCreateOpen(false);
			setName("");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className="flex h-8 max-w-48 items-center gap-2 rounded-md px-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						{isPending ? (
							<>
								<Skeleton className="size-5 rounded-full" />
								<Skeleton className="h-3.5 w-20" />
							</>
						) : (
							<>
								<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
									{active?.name?.charAt(0).toUpperCase() ?? "?"}
								</span>
								<span className="truncate">{active?.name ?? "No organization"}</span>
								<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
							</>
						)}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="min-w-56" align="start" sideOffset={6}>
					<DropdownMenuLabel className="text-xs text-muted-foreground">
						Organizations
					</DropdownMenuLabel>
					{organizations?.map((org) => (
						<DropdownMenuItem
							key={org.id}
							onSelect={() => switchOrganization(org.id)}
							className="gap-2"
						>
							<span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
								{org.name.charAt(0).toUpperCase()}
							</span>
							<span className="truncate">{org.name}</span>
							{org.id === active?.id && <Check className="ml-auto size-4" />}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem className="gap-2" onSelect={() => setCreateOpen(true)}>
						<span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-transparent">
							<Plus className="size-3.5" />
						</span>
						<span className="text-muted-foreground">Create organization</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Create organization</DialogTitle>
						<DialogDescription>
							Organizations group projects, services and team members.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							createOrganization();
						}}
						className="flex flex-col gap-4"
					>
						<div className="flex flex-col gap-2">
							<Label htmlFor="org-name">Name</Label>
							<Input
								id="org-name"
								placeholder="Acme Inc."
								value={name}
								onChange={(event) => setName(event.target.value)}
								autoFocus
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={!name.trim() || isCreating}>
								{isCreating ? "Creating..." : "Create"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
