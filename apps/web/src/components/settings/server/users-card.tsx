"use client";

import { format } from "date-fns";
import { Loader2, LogIn, Search, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useMounted } from "@/hooks/use-mounted";
import { authClient, useSession } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";

/**
 * Instance-level user management (better-auth `admin()` plugin). Only the
 * instance admin sees it — the endpoints refuse everyone else anyway, and the
 * card renders an "insufficient permissions" state rather than an empty table
 * if it is ever reached by someone else.
 *
 * Every action here is written to the audit log by the auth hooks in
 * `packages/server/src/lib/auth.ts` (`admin.user.banned`,
 * `admin.user.role.set`, `auth.impersonation.started`, …).
 */

interface AdminUser {
	id: string;
	name?: string | null;
	email: string;
	role?: string | null;
	banned?: boolean | null;
	banReason?: string | null;
	twoFactorEnabled?: boolean | null;
	createdAt: string | Date;
}

const PAGE_SIZE = 50;

const isInstanceAdminRole = (role: string | null | undefined): boolean =>
	(role ?? "")
		.split(",")
		.map((part) => part.trim())
		.includes("admin");

function ConfirmAction({
	title,
	description,
	actionLabel,
	onConfirm,
	trigger,
}: {
	title: string;
	description: string;
	actionLabel: string;
	onConfirm: () => void;
	trigger: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
							setOpen(false);
						}}
					>
						{actionLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/** One description for every branch — a differing one would hydrate-mismatch. */
const CARD_DESCRIPTION =
	"Accounts on this instance: instance role, bans, sessions and impersonation.";

export function UsersCard() {
	const { data: session, isPending: sessionPending } = useSession();
	const currentUserId = session?.user?.id;
	const viewerIsInstanceAdmin = isInstanceAdminRole(
		(session?.user as { role?: string | null } | undefined)?.role,
	);
	// The session resolves client-side only, so the server renders "no session"
	// and the client would immediately render the admin branch — a hydration
	// mismatch. Hold the neutral loading shell until both agree.
	const mounted = useMounted();
	const ready = mounted && !sessionPending;

	const [users, setUsers] = useState<AdminUser[]>([]);
	const [total, setTotal] = useState(0);
	const [search, setSearch] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [busyUserId, setBusyUserId] = useState<string | null>(null);

	const loadUsers = useCallback(async (searchValue: string) => {
		setIsLoading(true);
		const { data, error } = await authClient.admin.listUsers({
			query: {
				limit: PAGE_SIZE,
				sortBy: "createdAt",
				sortDirection: "asc",
				...(searchValue.trim()
					? { searchField: "email" as const, searchOperator: "contains" as const, searchValue }
					: {}),
			},
		});
		if (error) {
			setLoadError(error.message ?? "Failed to load users");
		} else {
			setLoadError(null);
			setUsers((data?.users ?? []) as unknown as AdminUser[]);
			setTotal(data?.total ?? data?.users?.length ?? 0);
		}
		setIsLoading(false);
	}, []);

	useEffect(() => {
		if (!ready) return;
		if (!viewerIsInstanceAdmin) {
			setIsLoading(false);
			return;
		}
		void loadUsers("");
	}, [loadUsers, ready, viewerIsInstanceAdmin]);

	async function run(userId: string, label: string, action: () => Promise<{ error?: unknown }>) {
		setBusyUserId(userId);
		const { error } = await action();
		setBusyUserId(null);
		if (error) {
			toastError(error, `Failed to ${label}`);
			return;
		}
		toast.success(`${label[0]?.toUpperCase()}${label.slice(1)} done`);
		await loadUsers(search);
	}

	async function impersonate(userId: string) {
		setBusyUserId(userId);
		const { error } = await authClient.admin.impersonateUser({ userId });
		setBusyUserId(null);
		if (error) {
			toastError(error, "Failed to impersonate");
			return;
		}
		toast.success("Impersonating — the session expires in one hour");
		window.location.href = "/dashboard";
	}

	if (!ready) {
		return (
			<SettingsSection id="users" title="Users" description={CARD_DESCRIPTION}>
				<div className="grid gap-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			</SettingsSection>
		);
	}

	if (!viewerIsInstanceAdmin) {
		return (
			<SettingsSection id="users" title="Users" description={CARD_DESCRIPTION}>
				<div className="flex flex-col items-center gap-2 py-10 text-center">
					<ShieldAlert className="size-8 text-muted-foreground" />
					<p className="text-sm font-medium">Insufficient permissions</p>
					<p className="text-sm text-muted-foreground">
						User management is only available to the instance admin.
					</p>
				</div>
			</SettingsSection>
		);
	}

	return (
		<SettingsSection
			id="users"
			title="Users"
			description={CARD_DESCRIPTION}
			actions={
				<form
					className="flex items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						void loadUsers(search);
					}}
				>
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search by email"
						className="h-9 w-48"
						aria-label="Search users by email"
					/>
					<Button type="submit" variant="outline" size="sm" className="h-9">
						<Search className="size-4" />
						Search
					</Button>
				</form>
			}
		>
			{isLoading ? (
				<div className="grid gap-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : loadError ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-center">
					<p className="text-sm font-medium">Could not load users</p>
					<p className="text-sm text-muted-foreground">{loadError}</p>
					<Button variant="outline" size="sm" onClick={() => void loadUsers(search)}>
						Retry
					</Button>
				</div>
			) : users.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{search ? "No account matches that search." : "No accounts on this instance yet."}
				</p>
			) : (
				<>
					<TableCard>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>User</TableHead>
									<TableHead>Instance role</TableHead>
									<TableHead>2FA</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Joined</TableHead>
									<TableHead className="w-40" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{users.map((user) => {
									const self = user.id === currentUserId;
									const busy = busyUserId === user.id;
									const banned = user.banned === true;
									return (
										<TableRow key={user.id}>
											<TableCell>
												<div className="grid gap-0.5">
													<span className="font-medium">{user.name || user.email}</span>
													<span className="text-xs text-muted-foreground">{user.email}</span>
												</div>
											</TableCell>
											<TableCell>
												<Select
													value={isInstanceAdminRole(user.role) ? "admin" : "user"}
													disabled={self || busy}
													onValueChange={(role) =>
														run(user.id, "set the instance role", () =>
															authClient.admin.setRole({
																userId: user.id,
																role: role === "admin" ? "admin" : "user",
															}),
														)
													}
												>
													<SelectTrigger className="h-8 w-28">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="user">User</SelectItem>
														{/* The column header already says "Instance role". */}
														<SelectItem value="admin">Admin</SelectItem>
													</SelectContent>
												</Select>
											</TableCell>
											<TableCell>
												{user.twoFactorEnabled ? (
													<Badge variant="secondary">
														<ShieldCheck className="size-3" />
														On
													</Badge>
												) : (
													<Badge variant="outline">Off</Badge>
												)}
											</TableCell>
											<TableCell>
												{banned ? (
													<Badge variant="destructive" title={user.banReason ?? undefined}>
														Banned
													</Badge>
												) : (
													<Badge variant="outline">Active</Badge>
												)}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{format(new Date(user.createdAt), "MMM d, yyyy")}
											</TableCell>
											<TableCell>
												<div className="flex items-center justify-end gap-1">
													{busy && <Loader2 className="size-4 animate-spin" />}
													{!self && (
														<ConfirmAction
															title={banned ? "Unban user" : "Ban user"}
															description={
																banned
																	? `${user.email} will be able to sign in again.`
																	: `${user.email} will be signed out everywhere and refused at sign-in until unbanned.`
															}
															actionLabel={banned ? "Unban" : "Ban"}
															onConfirm={() =>
																run(user.id, banned ? "unban the user" : "ban the user", () =>
																	banned
																		? authClient.admin.unbanUser({ userId: user.id })
																		: authClient.admin.banUser({ userId: user.id }),
																)
															}
															trigger={
																<Button variant="ghost" size="sm" disabled={busy}>
																	<ShieldOff className="size-4" />
																	{banned ? "Unban" : "Ban"}
																</Button>
															}
														/>
													)}
													{!self && (
														<ConfirmAction
															title="Impersonate user"
															description={`You will act as ${user.email} for up to one hour. The impersonation is recorded in the audit log.`}
															actionLabel="Impersonate"
															onConfirm={() => void impersonate(user.id)}
															trigger={
																<Button variant="ghost" size="sm" disabled={busy}>
																	<LogIn className="size-4" />
																	Impersonate
																</Button>
															}
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
					{total > users.length && (
						<p className="text-xs text-muted-foreground">
							Showing {users.length} of {total} accounts — narrow the list with a search.
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						Lost password or authenticator? The admin plugin cannot clear an enrolled TOTP secret,
						so recovery runs on the host:{" "}
						<code className="font-mono">
							docker exec nixploy node scripts/reset-admin.mjs &lt;email&gt;
						</code>{" "}
						sets a one-time password, removes two-factor and revokes every session.
					</p>
				</>
			)}
		</SettingsSection>
	);
}
