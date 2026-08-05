"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/**
 * Shown instead of the dashboard when the signed-in user belongs to no
 * organization — the state you land in after deleting your last one, or when
 * an admin removes your membership. Every org-scoped query would otherwise
 * fail with FORBIDDEN and the page would be a wall of error panels.
 */
export function NoOrganization({ userName }: { userName?: string | null }) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const suggestion = userName ? `${userName}'s Org` : "";
	const [name, setName] = useState(suggestion);
	const [isCreating, setIsCreating] = useState(false);

	async function handleCreate() {
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
			router.refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	}

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-secondary">
				<Building2 className="size-6 text-muted-foreground" />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-lg font-semibold">You have no organization</h1>
				<p className="max-w-md text-sm text-muted-foreground">
					Projects, servers and services all live inside an organization. Create one to get started,
					or ask an admin to invite you to theirs.
				</p>
			</div>
			<form
				className="flex w-full max-w-sm flex-col gap-3 text-left"
				onSubmit={(event) => {
					event.preventDefault();
					void handleCreate();
				}}
			>
				<div className="flex flex-col gap-2">
					<Label htmlFor="new-org-name">Organization name</Label>
					<Input
						id="new-org-name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Acme Inc"
						autoFocus
					/>
				</div>
				<Button type="submit" disabled={!name.trim() || isCreating}>
					{isCreating && <Loader2 className="size-4 animate-spin" />}
					Create organization
				</Button>
			</form>
		</div>
	);
}
