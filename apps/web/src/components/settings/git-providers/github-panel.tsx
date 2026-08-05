"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { GitBranch, Loader2, Plus, RefreshCw, Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { Badge } from "@/components/ui/badge";
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

export function GithubPanel() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");

	const { data: providers, isPending } = useQuery(trpc.github.all.queryOptions());

	const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.github.all.queryKey() });

	const createMutation = useMutation(
		trpc.github.create.mutationOptions({
			onSuccess: async () => {
				toast.success("GitHub provider added");
				await invalidate();
				setOpen(false);
				setName("");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const manifestMutation = useMutation(
		trpc.github.createAppManifest.mutationOptions({
			onSuccess: ({ url, manifest }) => {
				// Auto-submit the manifest to GitHub's app creation page.
				const form = document.createElement("form");
				form.method = "POST";
				form.action = url;
				const input = document.createElement("input");
				input.type = "hidden";
				input.name = "manifest";
				input.value = manifest;
				form.appendChild(input);
				document.body.appendChild(form);
				form.submit();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const syncMutation = useMutation(
		trpc.github.syncInstallation.mutationOptions({
			onSuccess: async () => {
				toast.success("Installation synced");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.github.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("GitHub provider removed");
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
							<GitBranch className="size-4 text-muted-foreground" />
							GitHub
						</CardTitle>
						<CardDescription>GitHub Apps used for repository deploys and webhooks.</CardDescription>
					</div>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm">
								<Plus className="size-4" />
								Add GitHub Provider
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add GitHub provider</DialogTitle>
								<DialogDescription>
									Create a provider, then register a GitHub App for it.
								</DialogDescription>
							</DialogHeader>
							<div className="grid gap-2">
								<Label htmlFor="github-name">Name</Label>
								<Input
									id="github-name"
									placeholder="e.g. my-org"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</div>
							<DialogFooter>
								<Button
									disabled={createMutation.isPending || !name}
									onClick={() => createMutation.mutate({ name })}
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
						<GitBranch className="size-8 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							No GitHub providers yet. Add one to deploy from GitHub repositories.
						</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>GitHub App</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-40 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{providers.map(({ github, gitProvider }) => {
								const configured = Boolean(github.githubAppId);
								return (
									<TableRow key={github.githubId}>
										<TableCell className="font-medium">{gitProvider.name}</TableCell>
										<TableCell className="text-muted-foreground">
											{github.githubAppName ?? "—"}
										</TableCell>
										<TableCell>
											<Badge variant={configured ? "default" : "secondary"}>
												{configured ? "Configured" : "Not configured"}
											</Badge>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{format(new Date(github.createdAt), "MMM d, yyyy")}
										</TableCell>
										<TableCell>
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="outline"
													size="sm"
													disabled={
														manifestMutation.isPending &&
														manifestMutation.variables?.githubId === github.githubId
													}
													onClick={() =>
														manifestMutation.mutate({
															githubId: github.githubId,
															baseUrl: window.location.origin,
														})
													}
												>
													{manifestMutation.isPending &&
													manifestMutation.variables?.githubId === github.githubId ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Rocket className="size-4" />
													)}
													{configured ? "Recreate App" : "Create GitHub App"}
												</Button>
												{configured && (
													<Button
														variant="ghost"
														size="icon"
														disabled={syncMutation.isPending}
														onClick={() =>
															syncMutation.mutate({
																githubId: github.githubId,
															})
														}
													>
														<RefreshCw
															className={syncMutation.isPending ? "size-4 animate-spin" : "size-4"}
														/>
														<span className="sr-only">Sync installation</span>
													</Button>
												)}
												<ConfirmDeleteDialog
													title="Remove GitHub provider"
													description={`Remove "${gitProvider.name}"? Applications using it will lose their GitHub source.`}
													isPending={removeMutation.isPending}
													onConfirm={() =>
														removeMutation.mutate({
															githubId: github.githubId,
														})
													}
												/>
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
