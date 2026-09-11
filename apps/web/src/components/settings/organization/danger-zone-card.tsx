"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SettingsSection } from "@/components/settings/settings-section";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";

/** Only the organization's owner may permanently delete it. */
export function DangerZoneCard() {
	const router = useRouter();
	const { data: session } = useSession();
	const { data: activeOrganization, isPending: isOrgPending } = authClient.useActiveOrganization();
	const [isOwner, setIsOwner] = useState(false);
	const [open, setOpen] = useState(false);
	const [confirmName, setConfirmName] = useState("");
	const [isDeleting, setIsDeleting] = useState(false);

	useEffect(() => {
		const organizationId = activeOrganization?.id;
		const userId = session?.user?.id;
		if (!organizationId || !userId) {
			setIsOwner(false);
			return;
		}
		let cancelled = false;
		authClient.organization
			.listMembers({ query: { organizationId } })
			.then(({ data, error }) => {
				if (cancelled) return;
				if (error) {
					// The card is owner-only; without a member list we cannot prove
					// ownership, so stay hidden but say why.
					setIsOwner(false);
					toastError(error, "Failed to load organization members");
					return;
				}
				const self = data?.members?.find((member) => member.userId === userId);
				setIsOwner(self?.role === "owner");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setIsOwner(false);
				toastError(error, "Failed to load organization members");
			});
		return () => {
			cancelled = true;
		};
	}, [activeOrganization?.id, session?.user?.id]);

	if (isOrgPending || !activeOrganization || !isOwner) {
		return null;
	}

	async function handleDelete() {
		if (!activeOrganization) return;
		setIsDeleting(true);
		const { error } = await authClient.organization.delete({
			organizationId: activeOrganization.id,
		});
		setIsDeleting(false);
		if (error) {
			toastError(error, "Failed to delete organization");
			return;
		}
		toast.success(`Organization "${activeOrganization.name}" deleted`);
		setOpen(false);
		router.push("/dashboard");
		router.refresh();
	}

	return (
		<>
			<SettingsSection
				danger
				title="Delete organization"
				description="Permanently delete every project, environment, service, domain, server and backup destination in this organization. This cannot be undone."
				actions={
					<Button
						variant="outline"
						className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={() => setOpen(true)}
					>
						Delete organization
					</Button>
				}
			/>
			<AlertDialog
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (!next) setConfirmName("");
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete "{activeOrganization.name}"?</AlertDialogTitle>
						<AlertDialogDescription>
							This tears down every Swarm service, Traefik route, volume and file on disk for every
							project in this organization, then deletes the organization itself. This action cannot
							be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="grid gap-2 text-left">
						<Label htmlFor="confirm-org-name">
							Type <span className="font-semibold">{activeOrganization.name}</span> to confirm
						</Label>
						<Input
							id="confirm-org-name"
							value={confirmName}
							onChange={(event) => setConfirmName(event.target.value)}
							autoComplete="off"
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={isDeleting || confirmName !== activeOrganization.name}
							onClick={(event) => {
								event.preventDefault();
								handleDelete();
							}}
						>
							{isDeleting && <Loader2 className="size-4 animate-spin" />}
							Delete organization
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
