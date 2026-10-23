"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { GitMerge, Loader2, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { LoadError } from "@/components/query-state";
import { EmptyState } from "@/components/services/empty-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { EditProviderDialog } from "@/components/settings/git-providers/edit-provider-dialog";
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
import { useSaveMutation } from "@/hooks/use-save-mutation";
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

	const listKey = trpc.gitlab.all.queryKey();

	const createMutation = useSaveMutation(trpc.gitlab.create.mutationOptions(), {
		successMessage: "GitLab provider added",
		invalidate: [listKey],
		onSuccess: () => {
			setOpen(false);
			setName("");
			setGitlabUrl("https://gitlab.com");
			setAccessToken("");
			setGroupName("");
		},
	});

	const testMutation = useSaveMutation(trpc.gitlab.testConnection.mutationOptions(), {
		successMessage: "Connection successful",
	});

	const updateMutation = useSaveMutation(trpc.gitlab.update.mutationOptions(), {
		successMessage: "GitLab provider updated",
		invalidate: [listKey],
	});

	const removeMutation = useSaveMutation(trpc.gitlab.remove.mutationOptions(), {
		successMessage: "GitLab provider removed",
		invalidate: [listKey],
	});

	return (
		<SettingsSection
			wide
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
							Add GitLab provider
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
				<LoadError
					title="Could not load GitLab providers"
					message={error.message || "Try again in a moment."}
					onRetry={() => void refetch()}
				/>
			) : !providers || providers.length === 0 ? (
				<EmptyState
					icon={GitMerge}
					title="No GitLab providers"
					description="No GitLab providers yet — add one to deploy from GitLab repositories."
				/>
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
