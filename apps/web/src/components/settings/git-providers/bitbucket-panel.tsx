"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Plug, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import { EditProviderDialog } from "@/components/settings/git-providers/edit-provider-dialog";
import { WebhookSecretDialog } from "@/components/settings/git-providers/webhook-secret-dialog";
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
import { toastError } from "@/lib/describe-error";
import { useTRPC, useTRPCClient } from "@/lib/trpc";

const BITBUCKET_EDIT_FIELDS = [
	{ key: "name", label: "Name" },
	{ key: "bitbucketWorkspaceName", label: "Workspace name" },
	{ key: "bitbucketUsername", label: "Username (for app password)" },
	{ key: "apiToken", label: "API token", secret: true, hint: "Blank keeps the stored token." },
	{
		key: "appPassword",
		label: "App password",
		secret: true,
		hint: "Blank keeps the stored app password.",
	},
];

export function BitbucketPanel() {
	const trpc = useTRPC();
	const trpcClient = useTRPCClient();
	const queryClient = useQueryClient();
	// Webhook payload URLs need the browser origin; resolved after mount.
	const [origin, setOrigin] = useState("");
	useEffect(() => setOrigin(window.location.origin), []);
	const [open, setOpen] = useState(false);
	const { can } = useCapabilities();
	const canManage = can("git_providers.manage");
	const manageHint = canManage ? undefined : missingCapabilityHint("git_providers.manage");
	const [name, setName] = useState("");
	const [workspace, setWorkspace] = useState("");
	const [username, setUsername] = useState("");
	const [appPassword, setAppPassword] = useState("");
	const [apiToken, setApiToken] = useState("");

	const {
		data: providers,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.bitbucket.all.queryOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.bitbucket.all.queryKey(),
		});

	const createMutation = useMutation(
		trpc.bitbucket.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Bitbucket provider added");
				await invalidate();
				setOpen(false);
				setName("");
				setWorkspace("");
				setUsername("");
				setAppPassword("");
				setApiToken("");
			},
			onError: (error) => toastError(error),
		}),
	);

	const testMutation = useMutation(
		trpc.bitbucket.testConnection.mutationOptions({
			onSuccess: () => toast.success("Connection successful"),
			onError: (error) => toastError(error),
		}),
	);

	const updateMutation = useMutation(
		trpc.bitbucket.update.mutationOptions({
			onSuccess: async () => {
				toast.success("Bitbucket provider updated");
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	const removeMutation = useMutation(
		trpc.bitbucket.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("Bitbucket provider removed");
				await invalidate();
			},
			onError: (error) => toastError(error),
		}),
	);

	return (
		<SettingsSection
			title="Bitbucket"
			description="Bitbucket Cloud workspaces connected with an API token or app password."
			actions={
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button size="sm" disabled={!canManage} title={manageHint}>
							<Plus className="size-4" />
							Add Bitbucket Provider
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Add Bitbucket provider</DialogTitle>
							<DialogDescription>Use an API token, or a username + app password.</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="bb-name">Name</Label>
								<Input id="bb-name" value={name} onChange={(e) => setName(e.target.value)} />
							</div>
							<div className="grid gap-2">
								<Label htmlFor="bb-workspace">Workspace name</Label>
								<Input
									id="bb-workspace"
									value={workspace}
									onChange={(e) => setWorkspace(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="bb-api-token">API token</Label>
								<Input
									id="bb-api-token"
									type="password"
									value={apiToken}
									onChange={(e) => setApiToken(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="bb-username">Username (for app password)</Label>
								<Input
									id="bb-username"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="bb-app-password">App password</Label>
								<Input
									id="bb-app-password"
									type="password"
									value={appPassword}
									onChange={(e) => setAppPassword(e.target.value)}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								disabled={
									createMutation.isPending || !name || (!apiToken && !(username && appPassword))
								}
								onClick={() =>
									createMutation.mutate({
										name,
										bitbucketWorkspaceName: workspace || undefined,
										bitbucketUsername: username || undefined,
										appPassword: appPassword || undefined,
										apiToken: apiToken || undefined,
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
					<p className="text-sm font-medium">Could not load Bitbucket providers</p>
					<p className="text-sm text-muted-foreground">
						{error.message || "Try again in a moment."}
					</p>
					<Button variant="outline" size="sm" onClick={() => void refetch()}>
						Retry
					</Button>
				</div>
			) : !providers || providers.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
					<p className="text-sm text-muted-foreground">No Bitbucket providers yet.</p>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Workspace</TableHead>
							<TableHead>Username</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-24 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{providers.map(({ bitbucket, gitProvider }) => (
							<TableRow key={bitbucket.bitbucketId}>
								<TableCell className="font-medium">{gitProvider.name}</TableCell>
								<TableCell className="text-muted-foreground">
									{bitbucket.bitbucketWorkspaceName ?? "—"}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{bitbucket.bitbucketUsername ?? "—"}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{format(new Date(bitbucket.createdAt), "MMM d, yyyy")}
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
													testMutation.variables?.bitbucketId === bitbucket.bitbucketId)
											}
											onClick={() =>
												testMutation.mutate({
													bitbucketId: bitbucket.bitbucketId,
												})
											}
										>
											{testMutation.isPending &&
											testMutation.variables?.bitbucketId === bitbucket.bitbucketId ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<Plug className="size-4" />
											)}
											<span className="sr-only">Test connection</span>
										</Button>
										<WebhookSecretDialog
											providerLabel="Bitbucket"
											webhookUrl={`${origin}/api/webhooks/bitbucket/${bitbucket.bitbucketId}`}
											instructions="In the repository settings add a webhook with this URL (push and pull request triggers) and paste the secret as the webhook “Secret”."
											fetchSecret={async () =>
												(
													await trpcClient.bitbucket.revealWebhookSecret.query({
														bitbucketId: bitbucket.bitbucketId,
													})
												).webhookSecret
											}
											disabled={!canManage}
											disabledReason={manageHint}
										/>
										<EditProviderDialog
											title="Edit Bitbucket provider"
											description="Rename the provider, change the workspace or username, or rotate credentials."
											fields={BITBUCKET_EDIT_FIELDS}
											initialValues={{
												name: gitProvider.name,
												bitbucketWorkspaceName: bitbucket.bitbucketWorkspaceName ?? "",
												bitbucketUsername: bitbucket.bitbucketUsername ?? "",
											}}
											disabled={!canManage}
											disabledReason={manageHint}
											onSubmit={(values) =>
												updateMutation.mutateAsync({
													bitbucketId: bitbucket.bitbucketId,
													name: values.name,
													bitbucketWorkspaceName: values.bitbucketWorkspaceName || null,
													bitbucketUsername: values.bitbucketUsername || null,
													...(values.apiToken ? { apiToken: values.apiToken } : {}),
													...(values.appPassword ? { appPassword: values.appPassword } : {}),
												})
											}
										/>
										<ConfirmDeleteDialog
											title="Remove Bitbucket provider"
											description={`Remove "${gitProvider.name}"?`}
											disabled={!canManage}
											disabledReason={manageHint}
											onConfirm={() =>
												removeMutation.mutateAsync({
													bitbucketId: bitbucket.bitbucketId,
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
