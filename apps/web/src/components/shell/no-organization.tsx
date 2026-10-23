"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";

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
				// better-auth resolves with `{ error }` instead of throwing.
				const activated = await authClient.organization.setActive({
					organizationId: data.id,
				});
				if (activated.error) {
					throw new Error(activated.error.message ?? "Failed to switch to the new organization");
				}
			}
			await queryClient.invalidateQueries();
			toast.success(`Organization "${trimmed}" created`);
			router.refresh();
		} catch (error) {
			toastError(error, "Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	}

	return (
		<Card className="min-w-0">
			<CardContent className="mx-auto my-10 flex min-h-[60vh] max-w-xl flex-col items-start justify-center gap-6">
				<div className="flex size-12 items-center justify-center rounded-lg border bg-muted">
					<Building2 className="size-6 text-muted-foreground" />
				</div>
				<div className="flex flex-col gap-3">
					<h1 className="text-3xl leading-tight font-semibold tracking-tight">
						You have no organization
					</h1>
					<p className="max-w-md text-sm leading-relaxed text-muted-foreground">
						Projects, servers and services all live inside an organization. Create one to get
						started, or ask an admin to invite you to theirs.
					</p>
				</div>
				<form
					className="flex w-full max-w-sm flex-col gap-3 text-left"
					onSubmit={(event) => {
						event.preventDefault();
						void handleCreate();
					}}
				>
					<Field>
						<FieldLabel htmlFor="new-org-name">Organization name</FieldLabel>
						<Input
							id="new-org-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Acme Inc"
							autoFocus
						/>
					</Field>
					<Button type="submit" disabled={!name.trim() || isCreating}>
						{isCreating && <Loader2 className="size-4 animate-spin" />}
						Create organization
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
