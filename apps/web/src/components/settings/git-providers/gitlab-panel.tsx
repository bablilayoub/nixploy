"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { GitMerge, Loader2, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { EditProviderDialog } from "@/components/settings/git-providers/edit-provider-dialog";
import { SettingsSection } from "@/components/settings/settings-section";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCapabilities } from "@/hooks/use-capabilities";
import { missingCapabilityHint } from "@/lib/capabilities";
import { useTRPC } from "@/lib/trpc";

const GITLAB_EDIT_FIELDS = [
	{ key: "name", label: "Name" },
	{ key: "gitlabUrl", label: "GitLab URL", placeholder: "https://gitlab.com" },
	{ key: "groupName", label: "Group name (optional)" },
	{
		key: "accessToken",
		label: "Access token",
		secret: true,
		hint: "Rotate the personal access token; blank keeps the stored one.",
	},
];

export function GitlabPanel() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const { can } = useCapabilities();
	const canManage = can("git_providers.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("git_providers.manage");
	const [name, setName] = useState("");
	const [gitlabUrl, setGitlabUrl] = useState("https://gitlab.com");
	const [accessToken, setAccessToken] = useState("");
	const [groupName, setGroupName] = useState("");

	const {
		data: providers,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.gitlab.all.queryOptions());

	const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.gitlab.all.queryKey() });

	const createMutation = useMutation(
		trpc.gitlab.create.mutationOptions({
			onSuccess: async () => {
				toast.success("GitLab provider added");
				await invalidate();
				setOpen(false);
				setName("");
				setGitlabUrl("https://gitlab.com");
				setAccessToken("");
				setGroupName("");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const testMutation = useMutation(
		trpc.gitlab.testConnection.mutationOptions({
			onSuccess: () => toast.success("Connection successful"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const updateMutation = useMutation(
		trpc.gitlab.update.mutationOptions({
			onSuccess: async () => {
				toast.success("GitLab provider updated");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.gitlab.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("GitLab provider removed");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<SettingsSection
			title={
				<span className="flex items-center gap-2">
					<GitMerge className="size-4 text-muted-foreground" />
					GitLab
				</span>
			}
			description="GitLab instances connected with a personal access token."
			actions={
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button size="sm" disabled={!canManage} title={manageHint}>
							<Plus className="size-4" />
							Add GitLab Provider
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Add GitLab provider</DialogTitle>
							<DialogDescription>Connect with a personal access token.</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="gitlab-name">Name</Label>
								<Input id="gitlab-name" value={name} onChange={(e) => setName(e.target.value)} />
							</div>
							<div className="grid gap-2">
								<Label htmlFor="gitlab-url">GitLab URL</Label>
								<Input
									id="gitlab-url"
									placeholder="https://gitlab.com"
									value={gitlabUrl}
									onChange={(e) => setGitlabUrl(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="gitlab-token">Access token</Label>
								<Input
									id="gitlab-token"
									type="password"
									value={accessToken}
									onChange={(e) => setAccessToken(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="gitlab-group">Group name (optional)</Label>
								<Input
									id="gitlab-group"
									value={groupName}
									onChange={(e) => setGroupName(e.target.value)}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								disabled={createMutation.isPending || !name || !accessToken}
								onClick={() =>
									createMutation.mutate({
										name,
										gitlabUrl: gitlabUrl || undefined,
										accessToken,
										groupName: groupName || undefined,
									})
								}
							>
								{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Add provider
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			}
		>
			{isPending ? (
				<div className="grid gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : isError ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
					<p className="text-sm font-medium">Could not load GitLab providers</p>
					<p className="text-sm text-muted-foreground">
						{error.message || "Try again in a moment."}
					</p>
					<Button variant="outline" size="sm" onClick={() => void refetch()}>
						Retry
					</Button>
				</div>
			) : !providers || providers.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
					<GitMerge className="size-8 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">No GitLab providers yet.</p>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>URL</TableHead>
							<TableHead>Group</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-24 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{providers.map(({ gitlab, gitProvider }) => (
							<TableRow key={gitlab.gitlabId}>
								<TableCell className="font-medium">{gitProvider.name}</TableCell>
								<TableCell className="text-muted-foreground">{gitlab.gitlabUrl}</TableCell>
								<TableCell className="text-muted-foreground">{gitlab.groupName ?? "—"}</TableCell>
								<TableCell className="text-muted-foreground">
									{format(new Date(gitlab.createdAt), "MMM d, yyyy")}
								</TableCell>
								<TableCell>
									<div className="flex items-center justify-end">
										<Button
											variant="ghost"
											size="icon"
											title={manageHint}
											disabled={
												!canManage ||
												(testMutation.isPending &&
													testMutation.variables?.gitlabId === gitlab.gitlabId)
											}
											onClick={() =>
												testMutation.mutate({
													gitlabId: gitlab.gitlabId,
												})
											}
										>
											{testMutation.isPending &&
											testMutation.variables?.gitlabId === gitlab.gitlabId ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Plug className="size-4" />
											)}
											<span className="sr-only">Test connection</span>
										</Button>
										<EditProviderDialog
											title="Edit GitLab provider"
											description="Rename the provider, change its URL or group, or rotate its token."
											fields={GITLAB_EDIT_FIELDS}
											initialValues={{
												name: gitProvider.name,
												gitlabUrl: gitlab.gitlabUrl ?? "",
												groupName: gitlab.groupName ?? "",
											}}
											disabled={!canManage}
											disabledReason={manageHint}
											onSubmit={(values) =>
												updateMutation.mutateAsync({
													gitlabId: gitlab.gitlabId,
													name: values.name,
													gitlabUrl: values.gitlabUrl || undefined,
													groupName: values.groupName || null,
													...(values.accessToken ? { accessToken: values.accessToken } : {}),
												})
											}
										/>
										<ConfirmDeleteDialog
											title="Remove GitLab provider"
											description={`Remove "${gitProvider.name}"?`}
											disabled={!canManage}
											disabledReason={manageHint}
											onConfirm={() =>
												removeMutation.mutateAsync({
													gitlabId: gitlab.gitlabId,
												})
											}
										/>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</SettingsSection>
	);
}
