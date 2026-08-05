"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { GitMerge, Loader2, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useTRPC } from "@/lib/trpc";

export function GitlabPanel() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [gitlabUrl, setGitlabUrl] = useState("https://gitlab.com");
	const [accessToken, setAccessToken] = useState("");
	const [groupName, setGroupName] = useState("");

	const { data: providers, isPending } = useQuery(trpc.gitlab.all.queryOptions());

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
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<GitMerge className="size-4 text-muted-foreground" />
							GitLab
						</CardTitle>
						<CardDescription>
							GitLab instances connected with a personal access token.
						</CardDescription>
					</div>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm">
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
				</div>
			</CardHeader>
			<CardContent>
				{isPending ? (
					<div className="grid gap-2">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
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
												disabled={
													testMutation.isPending &&
													testMutation.variables?.gitlabId === gitlab.gitlabId
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
											<ConfirmDeleteDialog
												title="Remove GitLab provider"
												description={`Remove "${gitProvider.name}"?`}
												isPending={removeMutation.isPending}
												onConfirm={() =>
													removeMutation.mutate({
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
			</CardContent>
		</Card>
	);
}
