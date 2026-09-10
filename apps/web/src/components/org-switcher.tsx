"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

function slugify(name: string) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "org"
	);
}

/** Compact org switcher for the top bar (Vercel-style team menu). */
export function OrgSwitcher({ className }: { className?: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { data: organizations, isPending } = authClient.useListOrganizations();
	const { data: activeOrganization } = authClient.useActiveOrganization();
	const { data: orgSettings } = useQuery(trpc.organization.settings.queryOptions());
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	const active = activeOrganization ?? organizations?.[0] ?? null;
	const displayName = orgSettings?.branding.displayName?.trim() || active?.name;
	const logoUrl = orgSettings?.logo;

	const switchOrganization = async (organizationId: string) => {
		if (organizationId === active?.id) return;
		try {
			// better-auth resolves with `{ error }` instead of throwing — only
			// refetch the cache once the server actually switched the org.
			const { error } = await authClient.organization.setActive({ organizationId });
			if (error) {
				toast.error(error.message ?? "Failed to switch organization");
				return;
			}
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
				const activated = await authClient.organization.setActive({ organizationId: data.id });
				if (activated.error) {
					throw new Error(activated.error.message ?? "Failed to switch to the new organization");
				}
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
					<Button variant="ghost" size="sm" className={cn("h-8 gap-2 px-2 font-normal", className)}>
						{isPending ? (
							<>
								<Skeleton className="size-5 rounded" />
								<Skeleton className="h-3.5 w-20" />
							</>
						) : (
							<>
								{logoUrl ? (
									// biome-ignore lint/performance/noImgElement: user-supplied white-label URL
									<img src={logoUrl} alt="" className="size-5 shrink-0 rounded object-cover" />
								) : (
									<span className="flex size-5 shrink-0 items-center justify-center rounded bg-foreground text-[10px] font-semibold text-background">
										{displayName?.charAt(0).toUpperCase() ?? "?"}
									</span>
								)}
								<span className="max-w-36 truncate text-sm font-medium">
									{displayName ?? "Organization"}
								</span>
								<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
							</>
						)}
					</Button>
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
							<span className="flex size-5 shrink-0 items-center justify-center rounded border text-[10px] font-semibold">
								{org.name.charAt(0).toUpperCase()}
							</span>
							<span className="truncate">{org.name}</span>
							{org.id === active?.id ? <Check className="ms-auto size-4" /> : null}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem className="gap-2" onSelect={() => setCreateOpen(true)}>
						<span className="flex size-5 shrink-0 items-center justify-center rounded border">
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
