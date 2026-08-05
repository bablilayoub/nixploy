"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function OrganizationCard() {
	const { data: activeOrganization, isPending: isOrgPending } = authClient.useActiveOrganization();
	const [name, setName] = useState("");
	const [isPending, setIsPending] = useState(false);

	useEffect(() => {
		if (activeOrganization?.name) {
			setName(activeOrganization.name);
		}
	}, [activeOrganization?.name]);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!activeOrganization) return;
		setIsPending(true);
		const { error } = await authClient.organization.update({
			organizationId: activeOrganization.id,
			data: { name },
		});
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to update organization");
			return;
		}
		toast.success("Organization updated");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Organization</CardTitle>
				<CardDescription>General settings for your active organization.</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSubmit} className="grid max-w-sm gap-4">
					<div className="grid gap-2">
						<Label htmlFor="org-name">Name</Label>
						<Input
							id="org-name"
							required
							disabled={isOrgPending || !activeOrganization}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="org-slug">Slug</Label>
						<Input id="org-slug" disabled value={activeOrganization?.slug ?? ""} />
					</div>
					<div>
						<Button
							type="submit"
							disabled={isPending || !name || name === activeOrganization?.name}
						>
							{isPending && <Loader2 className="size-4 animate-spin" />}
							Save changes
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
