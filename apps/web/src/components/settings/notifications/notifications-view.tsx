"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Bell, Loader2, Pencil, Plus, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { ConfirmDeleteDialog } from "@/components/settings/confirm-delete-dialog";
import {
	NOTIFICATION_TYPE_LABELS,
	NotificationDialog,
	type NotificationRow,
	type NotificationType,
} from "@/components/settings/notifications/notification-dialog";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function NotificationsView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);
	const [editing, setEditing] = useState<NotificationRow | null>(null);

	const {
		data: notifications,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.notification.all.queryOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.notification.all.queryKey(),
		});

	const testMutation = useMutation(
		trpc.notification.test.mutationOptions({
			onSuccess: () => toast.success("Test notification sent"),
			onError: (error) => toast.error(error.message),
		}),
	);

	const removeMutation = useMutation(
		trpc.notification.remove.mutationOptions({
			onSuccess: async () => {
				toast.success("Notification channel removed");
				await invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const grouped = (notifications ?? []).reduce<Record<string, NonNullable<typeof notifications>>>(
		(acc, notification) => {
			const list = acc[notification.type] ?? [];
			list.push(notification);
			acc[notification.type] = list;
			return acc;
		},
		{},
	);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Notifications"
				description="Channels that receive deployment, backup and platform events."
				actions={
					<Button size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="size-4" />
						Add Notification
					</Button>
				}
			/>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Bell className="size-4 text-muted-foreground" />
						Channels
					</CardTitle>
					<CardDescription>Notification channels grouped by type.</CardDescription>
				</CardHeader>
				<CardContent>
					<QueryState
						isPending={isPending}
						isError={isError}
						error={error}
						onRetry={() => refetch()}
						isEmpty={!notifications || notifications.length === 0}
						skeleton={
							<div className="grid gap-2">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						}
						empty={
							<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
								<Bell className="size-8 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									No notification channels yet. Add one to get alerted.
								</p>
							</div>
						}
					>
						<div className="grid gap-6">
							{Object.entries(grouped).map(([type, rows]) => (
								<div key={type} className="grid gap-2">
									<h3 className="text-sm font-medium text-muted-foreground">
										{NOTIFICATION_TYPE_LABELS[type as NotificationType] ?? type}
									</h3>
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Name</TableHead>
												<TableHead className="hidden md:table-cell">Events</TableHead>
												<TableHead className="hidden md:table-cell">Created</TableHead>
												<TableHead className="w-24 text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{rows.map((notification) => {
												const events = [
													notification.appDeploy && "Deploys",
													notification.appBuildError && "Build errors",
													notification.databaseBackup && "Backups",
													notification.nixployRestart && "Restarts",
													notification.dockerCleanup && "Cleanup",
													notification.serverThreshold && "Thresholds",
												].filter(Boolean);
												return (
													<TableRow key={notification.notificationId}>
														<TableCell className="font-medium">{notification.name}</TableCell>
														<TableCell className="hidden md:table-cell">
															{events.length === 0 ? (
																<span className="text-xs text-muted-foreground">None</span>
															) : (
																<span className="text-sm text-muted-foreground">
																	{events.join(", ")}
																</span>
															)}
														</TableCell>
														<TableCell className="hidden text-muted-foreground md:table-cell">
															{format(new Date(notification.createdAt), "MMM d, yyyy")}
														</TableCell>
														<TableCell>
															<div className="flex items-center justify-end">
																<Button
																	variant="ghost"
																	size="icon"
																	disabled={
																		testMutation.isPending &&
																		testMutation.variables?.notificationId ===
																			notification.notificationId
																	}
																	onClick={() =>
																		testMutation.mutate({
																			notificationId: notification.notificationId,
																		})
																	}
																>
																	{testMutation.isPending &&
																	testMutation.variables?.notificationId ===
																		notification.notificationId ? (
																		<Loader2 className="size-4 animate-spin" />
																	) : (
																		<Send className="size-4" />
																	)}
																	<span className="sr-only">Send test notification</span>
																</Button>
																<Button
																	variant="ghost"
																	size="icon"
																	onClick={() => setEditing(notification)}
																>
																	<Pencil className="size-4" />
																	<span className="sr-only">Edit notification channel</span>
																</Button>
																<ConfirmDeleteDialog
																	title="Remove notification channel"
																	description={`Remove "${notification.name}"?`}
																	isPending={removeMutation.isPending}
																	onConfirm={() =>
																		removeMutation.mutate({
																			notificationId: notification.notificationId,
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
								</div>
							))}
						</div>
					</QueryState>
				</CardContent>
			</Card>
			<NotificationDialog open={createOpen} onOpenChange={setCreateOpen} />
			<NotificationDialog
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
				editing={editing}
			/>
		</div>
	);
}
