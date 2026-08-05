"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Plug, Plus } from "lucide-react";
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

export function GiteaPanel() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [giteaUrl, setGiteaUrl] = useState("https://gitea.com");
	const [accessToken, setAccessToken] = useState("");

	const { data: providers, isPending } = useQuery(trpc.gitea.all.queryOptions());

	const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.gitea.all.queryKey() });

	const createMutation = useMutation(
		trpc.gitea.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Gitea provider added");
				await invalidate();
				setOpen(false);
				setName("");
				setGiteaUrl("https://gitea.com");
				setAccessToken("");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const testMutation = useMutation(
		trpc.gitea.testConnection.mutationOptions({
			onSuccess: () => toast.success("Connection successful"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.gitea.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("Gitea provider removed");
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
						<CardTitle>Gitea</CardTitle>
						<CardDescription>Gitea instances connected with an access token.</CardDescription>
					</div>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm">
								<Plus className="size-4" />
								Add Gitea Provider
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add Gitea provider</DialogTitle>
								<DialogDescription>Connect with a personal access token.</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="gitea-name">Name</Label>
									<Input id="gitea-name" value={name} onChange={(e) => setName(e.target.value)} />
								</div>
								<div className="grid gap-2">
									<Label htmlFor="gitea-url">Gitea URL</Label>
									<Input
										id="gitea-url"
										placeholder="https://gitea.com"
										value={giteaUrl}
										onChange={(e) => setGiteaUrl(e.target.value)}
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="gitea-token">Access token</Label>
									<Input
										id="gitea-token"
										type="password"
										value={accessToken}
										onChange={(e) => setAccessToken(e.target.value)}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									disabled={createMutation.isPending || !name || !accessToken}
									onClick={() =>
										createMutation.mutate({
											name,
											giteaUrl: giteaUrl || undefined,
											accessToken,
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
						<p className="text-sm text-muted-foreground">No Gitea providers yet.</p>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>URL</TableHead>
								<TableHead>Created</TableHead>
								<TableHead className="w-24 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{providers.map(({ gitea, gitProvider }) => (
								<TableRow key={gitea.giteaId}>
									<TableCell className="font-medium">{gitProvider.name}</TableCell>
									<TableCell className="text-muted-foreground">{gitea.giteaUrl}</TableCell>
									<TableCell className="text-muted-foreground">
										{format(new Date(gitea.createdAt), "MMM d, yyyy")}
									</TableCell>
									<TableCell>
										<div className="flex items-center justify-end">
											<Button
												variant="ghost"
												size="icon"
												disabled={
													testMutation.isPending &&
													testMutation.variables?.giteaId === gitea.giteaId
												}
												onClick={() =>
													testMutation.mutate({
														giteaId: gitea.giteaId,
													})
												}
											>
												{testMutation.isPending &&
												testMutation.variables?.giteaId === gitea.giteaId ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Plug className="size-4" />
												)}
												<span className="sr-only">Test connection</span>
											</Button>
											<ConfirmDeleteDialog
												title="Remove Gitea provider"
												description={`Remove "${gitProvider.name}"?`}
												isPending={removeMutation.isPending}
												onConfirm={() =>
													removeMutation.mutate({
														giteaId: gitea.giteaId,
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
