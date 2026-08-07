"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link2, Loader2, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/services/copy-button";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { MemberCapabilitiesDialog } from "@/components/settings/organization/member-capabilities-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
import { StatusDot } from "@/components/shell";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { UserAvatar } from "@/components/user-avatar";
import { authClient, useSession } from "@/lib/auth-client";
import { useTRPC } from "@/lib/trpc";

type InvitableRole = "viewer" | "member" | "deployer" | "admin";

const INVITABLE_ROLES: { value: InvitableRole; label: string }[] = [
	{ value: "viewer", label: "Viewer" },
	{ value: "member", label: "Member" },
	{ value: "deployer", label: "Deployer" },
	{ value: "admin", label: "Admin" },
];

interface MemberRow {
	id: string;
	userId: string;
	role: string;
	createdAt: string | Date;
	user?: { name?: string | null; email?: string | null };
}

interface InvitationRow {
	id: string;
	email: string;
	role: string;
	status: string;
	expiresAt: string | Date;
}

function invitationLink(invitationId: string): string {
	if (typeof window === "undefined") return `/accept-invitation/${invitationId}`;
	return `${window.location.origin}/accept-invitation/${invitationId}`;
}

export function MembersCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const { data: activeOrganization, isPending: isOrgPending } = authClient.useActiveOrganization();
	const organizationId = activeOrganization?.id;

	const [members, setMembers] = useState<MemberRow[]>([]);
	const [invitations, setInvitations] = useState<InvitationRow[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [createdLink, setCreatedLink] = useState<string | null>(null);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<InvitableRole>("member");
	const [expiryDays, setExpiryDays] = useState<"1" | "7" | "30">("7");

	const inviteMember = useMutation({
		...trpc.organization.inviteMember.mutationOptions(),
		onSuccess: async (data, variables) => {
			const link = invitationLink(data.id);
			try {
				await navigator.clipboard.writeText(link);
				toast.success(`Invite link for ${variables.email} copied`);
			} catch {
				toast.success(`Invitation created for ${variables.email}`);
			}
			setCreatedLink(link);
			setEmail("");
			setRole("member");
			setExpiryDays("7");
			await loadMembers();
		},
		onError: (error) => toast.error(error.message),
	});

	const loadMembers = useCallback(async () => {
		if (!organizationId) {
			setIsLoading(false);
			return;
		}
		const [membersResult, invitationsResult] = await Promise.all([
			authClient.organization.listMembers({
				query: { organizationId },
			}),
			authClient.organization.listInvitations({
				query: { organizationId },
			}),
		]);
		if (membersResult.error) {
			toast.error(membersResult.error.message ?? "Failed to load members");
		} else {
			setMembers((membersResult.data?.members ?? []) as unknown as MemberRow[]);
		}
		if (!invitationsResult.error) {
			const all = (invitationsResult.data ?? []) as unknown as InvitationRow[];
			setInvitations(all.filter((invitation) => invitation.status === "pending"));
		}
		setIsLoading(false);
	}, [organizationId]);

	useEffect(() => {
		loadMembers();
	}, [loadMembers]);

	async function removeMember(member: MemberRow) {
		if (!organizationId) return;
		const { error } = await authClient.organization.removeMember({
			memberIdOrEmail: member.id,
			organizationId,
		});
		if (error) {
			toast.error(error.message ?? "Failed to remove member");
			return;
		}
		toast.success("Member removed");
		await loadMembers();
	}

	async function changeRole(member: MemberRow, nextRole: string) {
		if (!organizationId) return;
		const { error } = await authClient.organization.updateMemberRole({
			memberId: member.id,
			role: nextRole as InvitableRole,
			organizationId,
		});
		if (error) {
			toast.error(error.message ?? "Failed to change role");
			return;
		}
		toast.success("Role updated");
		await loadMembers();
		// Capabilities defaults follow the role — refresh any open/cached matrix.
		await queryClient.invalidateQueries({
			queryKey: trpc.organization.memberCapabilities.queryKey({ memberId: member.id }),
		});
		await queryClient.invalidateQueries({
			queryKey: trpc.organization.myCapabilities.queryKey(),
		});
	}

	async function cancelInvitation(invitation: InvitationRow) {
		const { error } = await authClient.organization.cancelInvitation({
			invitationId: invitation.id,
		});
		if (error) {
			toast.error(error.message ?? "Failed to cancel invitation");
			return;
		}
		toast.success(`Invitation to ${invitation.email} cancelled`);
		await loadMembers();
	}

	const inviteDialog = (
		<Dialog
			open={inviteOpen}
			onOpenChange={(open) => {
				setInviteOpen(open);
				if (!open) setCreatedLink(null);
			}}
		>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="size-4" />
					Invite Member
				</Button>
			</DialogTrigger>
			<DialogContent>
				{createdLink ? (
					<>
						<DialogHeader>
							<DialogTitle>Share invite link</DialogTitle>
							<DialogDescription>
								No email is sent. Copy this link and give it to the invitee so they can create their
								account and join.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-3">
							<div className="flex gap-2">
								<Input value={createdLink} readOnly className="font-mono text-xs" />
								<CopyButton value={createdLink} label="Copy" />
							</div>
						</div>
						<DialogFooter>
							<Button
								onClick={() => {
									setInviteOpen(false);
									setCreatedLink(null);
								}}
							>
								Done
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Invite member</DialogTitle>
							<DialogDescription>
								Create a unique invite link. Share it yourself — Nixploy does not send email.
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="invite-email">Email</Label>
								<Input
									id="invite-email"
									type="email"
									placeholder="teammate@example.com"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									The invitee must sign up with this exact email.
								</p>
							</div>
							<div className="grid gap-2">
								<Label>Role</Label>
								<Select value={role} onValueChange={(value) => setRole(value as InvitableRole)}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{INVITABLE_ROLES.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label>Expires in</Label>
								<Select
									value={expiryDays}
									onValueChange={(value) => setExpiryDays(value as "1" | "7" | "30")}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="1">1 day</SelectItem>
										<SelectItem value="7">7 days</SelectItem>
										<SelectItem value="30">30 days</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
						<DialogFooter>
							<Button
								disabled={inviteMember.isPending || !email}
								onClick={() =>
									inviteMember.mutate({
										email,
										role,
										expiryDays: Number.parseInt(expiryDays, 10) as 1 | 7 | 30,
									})
								}
							>
								{inviteMember.isPending && <Loader2 className="size-4 animate-spin" />}
								Create invite link
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);

	return (
		<SettingsSection
			title="Members"
			description="People with access to this organization."
			wide
			actions={inviteDialog}
		>
			{isLoading || isOrgPending ? (
				<div className="grid gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : members.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
					<Users className="size-8 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">No members found for this organization.</p>
				</div>
			) : (
				<TableCard>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Member</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead>Role</TableHead>
								<TableHead className="w-12" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.map((member) => {
								const isSelf = member.userId === session?.user?.id;
								const isOwner = member.role === "owner";
								const displayName = member.user?.name ?? member.user?.email ?? "Unknown";
								return (
									<TableRow key={member.id}>
										<TableCell>
											<div className="flex items-center gap-3">
												<UserAvatar
													user={member.user}
													className="size-8"
													fallbackClassName="text-xs font-semibold"
													size={64}
												/>
												<div className="grid">
													<span className="text-sm font-medium">
														{displayName}
														{isSelf && (
															<span className="ml-2 text-xs text-muted-foreground">(you)</span>
														)}
													</span>
													<span className="text-xs text-muted-foreground">
														{member.user?.email}
													</span>
												</div>
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{format(new Date(member.createdAt), "MMM d, yyyy")}
										</TableCell>
										<TableCell>
											{isOwner || isSelf ? (
												<span className="flex items-center gap-2 text-sm capitalize">
													<StatusDot status={isOwner ? "info" : "neutral"} />
													{member.role}
												</span>
											) : (
												<Select
													value={member.role}
													onValueChange={(value) => changeRole(member, value)}
												>
													<SelectTrigger className="h-8 w-28">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														{INVITABLE_ROLES.map((item) => (
															<SelectItem key={item.value} value={item.value}>
																{item.label}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											)}
										</TableCell>
										<TableCell>
											<div className="flex items-center justify-end gap-1">
												{!isOwner && (
													<MemberCapabilitiesDialog
														memberId={member.id}
														memberName={displayName}
														memberRole={member.role}
													/>
												)}
												{!isOwner && !isSelf && (
													<ConfirmDeleteDialog
														title="Remove member"
														description={`Remove ${displayName} from this organization?`}
														onConfirm={() => removeMember(member)}
													/>
												)}
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</TableCard>
			)}
			{!isLoading && !isOrgPending && invitations.length > 0 && (
				<div className="mt-6 flex flex-col gap-3">
					<p className="text-sm font-medium text-muted-foreground">Pending invitations</p>
					<div className="divide-y rounded-lg border">
						{invitations.map((invitation) => (
							<div key={invitation.id} className="flex items-center gap-3 px-4 py-3">
								<Link2 className="size-4 shrink-0 text-muted-foreground" />
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate text-sm font-medium">{invitation.email}</span>
									<span className="text-xs text-muted-foreground capitalize">
										{invitation.role} · expires{" "}
										{format(new Date(invitation.expiresAt), "MMM d, yyyy 'at' h:mm a")}
									</span>
								</div>
								<CopyButton value={invitationLink(invitation.id)} label="Copy link" />
								<Button variant="ghost" size="sm" onClick={() => cancelInvitation(invitation)}>
									Cancel
								</Button>
							</div>
						))}
					</div>
				</div>
			)}
		</SettingsSection>
	);
}
