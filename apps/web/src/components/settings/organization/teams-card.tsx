"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, Loader2, Plus, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { LoadError } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
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
import { HelpLink } from "@/components/ui/help-link";
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
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSession } from "@/lib/auth-client";
import { missingCapabilityHint } from "@/lib/capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

/**
 * Teams answer "which projects", not "what may they do".
 *
 * The role ladder stays the only thing that decides capabilities; a team only
 * narrows the set of projects a member can see, and only for members whose
 * project scope is set to `teams`. That split is why this card carries two
 * tables — the teams themselves, and who is constrained by them.
 */

type Team = {
	teamId: string;
	name: string;
	description: string | null;
	members: { userId: string; name: string | null; email: string }[];
	projects: { projectId: string; name: string }[];
};

/** A checkbox list that fits in a dialog without becoming a scroll maze. */
function PickList({
	name,
	items,
	selected,
	onToggle,
	empty,
}: {
	/** Prefix for the checkbox ids, so two lists in one dialog stay distinct. */
	name: string;
	items: { id: string; label: string; hint?: string | null }[];
	selected: Set<string>;
	onToggle: (id: string) => void;
	empty: string;
}) {
	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">{empty}</p>;
	}
	return (
		<div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
			{items.map((item) => (
				<label
					key={item.id}
					htmlFor={`${name}-${item.id}`}
					className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 hover:bg-muted/50"
				>
					<Checkbox
						id={`${name}-${item.id}`}
						checked={selected.has(item.id)}
						onCheckedChange={() => onToggle(item.id)}
					/>
					<span className="grid min-w-0">
						<span className="truncate text-sm">{item.label}</span>
						{item.hint ? (
							<span className="truncate text-xs text-muted-foreground">{item.hint}</span>
						) : null}
					</span>
				</label>
			))}
		</div>
	);
}

export function TeamsCard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const { can } = useCapabilities();
	const canManage = can("members.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("members.manage");

	const teamsQuery = useQuery({ ...trpc.team.all.queryOptions(), enabled: canManage });
	const scopesQuery = useQuery({ ...trpc.team.memberScopes.queryOptions(), enabled: canManage });
	const projectsQuery = useQuery({ ...trpc.project.all.queryOptions(), enabled: canManage });

	const invalidate = async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.team.all.queryKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.team.memberScopes.queryKey() }),
		]);
	};

	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [editing, setEditing] = useState<Team | null>(null);

	const createTeam = useMutation({
		...trpc.team.create.mutationOptions(),
		onSuccess: async () => {
			toast.success("Team created");
			setCreateOpen(false);
			setName("");
			setDescription("");
			await invalidate();
		},
		onError: (error) => toastError(error, "Failed to create team"),
	});

	const deleteTeam = useMutation({
		...trpc.team.delete.mutationOptions(),
		onSuccess: async () => {
			toast.success("Team deleted");
			await invalidate();
		},
		onError: (error) => toastError(error, "Failed to delete team"),
	});

	const setMemberScope = useMutation({
		...trpc.team.setMemberScope.mutationOptions(),
		onSuccess: async () => {
			toast.success("Project scope updated");
			await invalidate();
		},
		onError: (error) => toastError(error, "Failed to change the project scope"),
	});

	const teams = (teamsQuery.data ?? []) as Team[];
	const scopes = scopesQuery.data ?? [];
	const scopedCount = scopes.filter((row) => row.projectScope === "teams").length;

	if (!canManage) {
		return (
			<SettingsSection
				title="Teams"
				description="Managing teams requires the members.manage capability."
			>
				<p className="text-sm text-muted-foreground">{manageHint}</p>
			</SettingsSection>
		);
	}

	return (
		<>
			<SettingsSection
				bare
				title="Teams"
				description={
					<>
						A team is a set of people attached to a set of projects. It changes{" "}
						<em>which projects</em> a member can see, never what they may do — that stays the role.{" "}
						<HelpLink slug="teams" />
					</>
				}
				actions={
					<Button size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="size-4" />
						New team
					</Button>
				}
			>
				{teamsQuery.isPending ? (
					<Skeleton className="h-24 w-full" />
				) : teamsQuery.isError ? (
					<LoadError message="Failed to load teams" onRetry={() => teamsQuery.refetch()} />
				) : teams.length === 0 ? (
					<EmptyState
						icon={UsersRound}
						title="No teams yet"
						description="Create one, attach projects to it, then switch a member's project scope to teams."
					/>
				) : (
					<TableCard>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Team</TableHead>
									<TableHead>Members</TableHead>
									<TableHead>Projects</TableHead>
									<TableHead className="w-px" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{teams.map((team) => (
									<TableRow key={team.teamId}>
										<TableCell>
											<div className="grid">
												<span className="text-sm font-medium">{team.name}</span>
												{team.description ? (
													<span className="text-xs text-muted-foreground">{team.description}</span>
												) : null}
											</div>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{team.members.length === 0
												? "Nobody"
												: team.members
														.map((member) => member.name ?? member.email)
														.slice(0, 3)
														.join(", ") +
													(team.members.length > 3 ? ` +${team.members.length - 3}` : "")}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{team.projects.length === 0
												? "None"
												: team.projects
														.map((project) => project.name)
														.slice(0, 3)
														.join(", ") +
													(team.projects.length > 3 ? ` +${team.projects.length - 3}` : "")}
										</TableCell>
										<TableCell>
											<div className="flex justify-end gap-2">
												<Button size="sm" variant="outline" onClick={() => setEditing(team)}>
													Edit
												</Button>
												<ConfirmDeleteDialog
													title="Delete team"
													description={
														team.projects.length > 0
															? `Members scoped to teams lose access to ${team.projects.length} project(s) this team reached.`
															: "This team reaches no projects, so nobody loses access."
													}
													onConfirm={() => deleteTeam.mutateAsync({ teamId: team.teamId })}
												/>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableCard>
				)}
			</SettingsSection>

			<SettingsSection
				bare
				title="Project access"
				description={
					scopedCount === 0
						? "Everyone currently sees every project in this organization. Switch someone to teams to narrow them."
						: `${scopedCount} member(s) see only the projects their teams reach.`
				}
			>
				{scopesQuery.isPending ? (
					<Skeleton className="h-24 w-full" />
				) : scopesQuery.isError ? (
					<LoadError message="Failed to load members" onRetry={() => scopesQuery.refetch()} />
				) : (
					<TableCard>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Member</TableHead>
									<TableHead>Role</TableHead>
									<TableHead className="w-56">Sees</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{scopes.map((row) => {
									const isSelf = row.userId === session?.user?.id;
									const administers = row.role === "owner" || row.role === "admin";
									const locked = isSelf || administers;
									return (
										<TableRow key={row.userId}>
											<TableCell>
												<div className="grid">
													<span className="text-sm font-medium">
														{row.name ?? row.email}
														{isSelf ? (
															<span className="ml-2 text-xs text-muted-foreground">(you)</span>
														) : null}
													</span>
													<span className="text-xs text-muted-foreground">{row.email}</span>
												</div>
											</TableCell>
											<TableCell className="text-sm capitalize text-muted-foreground">
												{row.role}
											</TableCell>
											<TableCell>
												{locked ? (
													<span
														className="text-sm text-muted-foreground"
														title={
															isSelf
																? "Ask another admin — nobody may scope themselves out of the projects they administer."
																: "An owner or admin administers the whole organization."
														}
													>
														Every project
													</span>
												) : (
													<Select
														value={row.projectScope}
														onValueChange={(value) =>
															setMemberScope.mutate({
																userId: row.userId,
																projectScope: value as "organization" | "teams",
															})
														}
													>
														<SelectTrigger className="h-8">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="organization">Every project</SelectItem>
															<SelectItem value="teams">Only their teams'</SelectItem>
														</SelectContent>
													</Select>
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</TableCard>
				)}
			</SettingsSection>

			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>New team</DialogTitle>
						<DialogDescription>
							Name it after the people, not the projects — a team can be pointed at different
							projects later.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="team-name">Name</Label>
							<Input
								id="team-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="Platform"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="team-description">Description</Label>
							<Input
								id="team-description"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
								placeholder="Optional"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setCreateOpen(false)}>
							Cancel
						</Button>
						<Button
							disabled={name.trim().length === 0 || createTeam.isPending}
							onClick={() =>
								createTeam.mutate({
									name: name.trim(),
									description: description.trim() || null,
								})
							}
						>
							{createTeam.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<EditTeamDialog
				team={editing}
				onClose={() => setEditing(null)}
				onSaved={invalidate}
				people={scopes}
				projects={projectsQuery.data ?? []}
			/>
		</>
	);
}

/** Members and projects of one team, both replaced wholesale on save. */
function EditTeamDialog({
	team,
	onClose,
	onSaved,
	people,
	projects,
}: {
	team: Team | null;
	onClose: () => void;
	onSaved: () => Promise<void>;
	people: { userId: string; name: string | null; email: string }[];
	projects: { projectId: string; name: string }[];
}) {
	const trpc = useTRPC();
	const [userIds, setUserIds] = useState<Set<string>>(new Set());
	const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
	const [name, setName] = useState("");

	useEffect(() => {
		if (!team) return;
		setName(team.name);
		setUserIds(new Set(team.members.map((member) => member.userId)));
		setProjectIds(new Set(team.projects.map((project) => project.projectId)));
	}, [team]);

	const setMembers = useMutation(trpc.team.setMembers.mutationOptions());
	const setProjects = useMutation(trpc.team.setProjects.mutationOptions());
	const update = useMutation(trpc.team.update.mutationOptions());
	const saving = setMembers.isPending || setProjects.isPending || update.isPending;

	const peopleItems = useMemo(
		() =>
			people.map((person) => ({
				id: person.userId,
				label: person.name ?? person.email,
				hint: person.email,
			})),
		[people],
	);
	const projectItems = useMemo(
		() => projects.map((project) => ({ id: project.projectId, label: project.name })),
		[projects],
	);

	async function save() {
		if (!team) return;
		try {
			if (name.trim() && name.trim() !== team.name) {
				await update.mutateAsync({ teamId: team.teamId, name: name.trim() });
			}
			await setMembers.mutateAsync({ teamId: team.teamId, userIds: [...userIds] });
			await setProjects.mutateAsync({ teamId: team.teamId, projectIds: [...projectIds] });
			toast.success("Team saved");
			await onSaved();
			onClose();
		} catch (error) {
			toastError(error, "Failed to save the team");
		}
	}

	const toggle = (set: Set<string>, update_: (next: Set<string>) => void) => (id: string) => {
		const next = new Set(set);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		update_(next);
	};

	return (
		<Dialog open={team !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Edit team</DialogTitle>
					<DialogDescription>
						Members here only lose sight of other projects once their project scope is set to teams.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="edit-team-name">Name</Label>
						<Input
							id="edit-team-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label className="flex items-center gap-2">
								<UsersRound className="size-4" />
								Members
							</Label>
							<PickList
								name="team-member"
								items={peopleItems}
								selected={userIds}
								onToggle={toggle(userIds, setUserIds)}
								empty="No members in this organization."
							/>
						</div>
						<div className="space-y-2">
							<Label className="flex items-center gap-2">
								<FolderTree className="size-4" />
								Projects
							</Label>
							<PickList
								name="team-project"
								items={projectItems}
								selected={projectIds}
								onToggle={toggle(projectIds, setProjectIds)}
								empty="No projects yet."
							/>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={saving} onClick={save}>
						{saving ? <Loader2 className="size-4 animate-spin" /> : null}
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
