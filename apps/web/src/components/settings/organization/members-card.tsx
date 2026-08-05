"use client";

import { format } from "date-fns";
import { Loader2, Mail, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { StatusDot } from "@/components/shell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { authClient, useSession } from "@/lib/auth-client";

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

export function MembersCard() {
	const { data: session } = useSession();
	const { data: activeOrganization, isPending: isOrgPending } = authClient.useActiveOrganization();
	const organizationId = activeOrganization?.id;

	const [members, setMembers] = useState<MemberRow[]>([]);
	const [invitations, setInvitations] = useState<InvitationRow[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"admin" | "member">("member");
	const [isPending, setIsPending] = useState(false);

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

	async function inviteMember() {
		if (!organizationId) return;
		setIsPending(true);
		const { error } = await authClient.organization.inviteMember({
			email,
			role,
			organizationId,
		});
		setIsPending(false);
		if (error) {
			toast.error(error.message ?? "Failed to invite member");
			return;
		}
		toast.success(`Invitation sent to ${email}`);
		setInviteOpen(false);
		setEmail("");
		setRole("member");
		await loadMembers();
	}

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
			role: nextRole as "admin" | "member",
			organizationId,
		});
		if (error) {
			toast.error(error.message ?? "Failed to change role");
			return;
		}
		toast.success("Role updated");
		await loadMembers();
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

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Users className="size-4 text-muted-foreground" />
							Members
						</CardTitle>
						<CardDescription>People with access to this organization.</CardDescription>
					</div>
					<Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
						<DialogTrigger asChild>
							<Button size="sm">
								<Plus className="size-4" />
								Invite Member
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Invite member</DialogTitle>
								<DialogDescription>Send an invitation to join this organization.</DialogDescription>
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
								</div>
								<div className="grid gap-2">
									<Label>Role</Label>
									<Select
										value={role}
										onValueChange={(value) => setRole(value as "admin" | "member")}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="member">Member</SelectItem>
											<SelectItem value="admin">Admin</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<DialogFooter>
								<Button disabled={isPending || !email} onClick={inviteMember}>
									{isPending && <Loader2 className="size-4 animate-spin" />}
									Send invitation
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</CardHeader>
			<CardContent>
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
												<Avatar className="size-8">
													<AvatarFallback className="text-xs font-semibold">
														{displayName.charAt(0).toUpperCase()}
													</AvatarFallback>
												</Avatar>
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
														<SelectItem value="member">Member</SelectItem>
														<SelectItem value="admin">Admin</SelectItem>
													</SelectContent>
												</Select>
											)}
										</TableCell>
										<TableCell>
											{!isOwner && !isSelf && (
												<ConfirmDeleteDialog
													title="Remove member"
													description={`Remove ${displayName} from this organization?`}
													onConfirm={() => removeMember(member)}
												/>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
				{!isLoading && !isOrgPending && invitations.length > 0 && (
					<div className="mt-6 flex flex-col gap-3">
						<p className="text-sm font-medium text-muted-foreground">Pending invitations</p>
						<div className="divide-y rounded-lg border">
							{invitations.map((invitation) => (
								<div key={invitation.id} className="flex items-center gap-3 px-4 py-3">
									<Mail className="size-4 shrink-0 text-muted-foreground" />
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-sm font-medium">{invitation.email}</span>
										<span className="text-xs text-muted-foreground capitalize">
											{invitation.role} · expires{" "}
											{format(new Date(invitation.expiresAt), "MMM d, yyyy")}
										</span>
									</div>
									<Button variant="ghost" size="sm" onClick={() => cancelInvitation(invitation)}>
										Cancel
									</Button>
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
