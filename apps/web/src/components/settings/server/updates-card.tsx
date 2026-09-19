"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
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
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

/** `1.2.3` / `v1.2.3` — the same shape the server accepts. */
const VERSION_INPUT = /^v?\d+\.\d+\.\d+$/;

/** "Checked 3 hours ago" — one shared formatter, not `toLocaleString` (UX audit F27). */
function formatWhen(iso: string | null | undefined): string {
	if (!iso) return "Never checked";
	const when = formatRelative(iso);
	return when === "—" ? iso : `Checked ${when}`;
}

/** Platform self-update: check GHCR digests, toggle auto-update, roll the service. */
export function UpdatesCard() {
	const trpc = useTRPC();

	const statusQuery = useQuery({
		...trpc.updates.getStatus.queryOptions(),
		refetchInterval: (query) => (query.state.data?.updateInProgress ? 5_000 : 60_000),
	});

	// The Update dialog is controlled so the preflight runs while it is open
	// and the confirm can wait for it.
	const [updateOpen, setUpdateOpen] = useState(false);
	const preflightQuery = useQuery({
		...trpc.updates.preflight.queryOptions({}),
		enabled: updateOpen,
		staleTime: 0,
	});
	// Deployments in flight when the update was requested; opens the "update anyway?" confirm.
	const [blockedBy, setBlockedBy] = useState<number | null>(null);
	// Version typed into "Update to…", held while the downgrade confirm is open.
	const [targetVersion, setTargetVersion] = useState("");
	const [downgradeTo, setDowngradeTo] = useState<string | null>(null);
	const [notesOpen, setNotesOpen] = useState(false);

	// The switches mirror the server, but a dirty draft is not re-seeded: the
	// 60s poll would otherwise flip an optimistic switch back until the
	// mutation's own invalidate lands. A failed save resets to the server value.
	const toggles = useDraft({
		autoCheck: statusQuery.data?.autoCheckEnabled ?? true,
		autoUpdate: statusQuery.data?.autoUpdateEnabled ?? false,
	});
	const { autoCheck, autoUpdate } = toggles.value;

	// The pin mirrors the server but is typed freely, so it gets its own draft.
	const pin = useDraft(statusQuery.data?.pinnedVersion ?? "");

	const statusKey = trpc.updates.getStatus.queryKey();

	const settingsMutation = useSaveMutation(
		trpc.updates.updateSettings.mutationOptions({ onError: () => toggles.reset() }),
		{
			successMessage: "Update settings saved",
			invalidate: [statusKey],
			onSuccess: toggles.markSaved,
		},
	);

	const checkMutation = useSaveMutation(
		trpc.updates.check.mutationOptions({
			// The toast depends on the result, so it stays next to the call.
			onSuccess: (result) => {
				if (result.error) {
					toast.error(result.error);
				} else if (result.updateAvailable) {
					toast.success("A new version is available");
				} else {
					toast.success("You're on the latest version");
				}
			},
		}),
		{ invalidate: [statusKey] },
	);

	const applyMutation = useSaveMutation(
		trpc.updates.runUpdate.mutationOptions({
			onSuccess: (result) => {
				if (result.started) {
					toast.success(result.message);
				} else if (result.blockedByDeployments) {
					setBlockedBy(result.activeDeployments ?? 1);
				} else {
					toast.message(result.message);
				}
			},
		}),
		{ invalidate: [statusKey] },
	);

	/**
	 * The server refuses a downgrade unless it is acknowledged (migrations are
	 * never reversed). Catch that one refusal and ask, instead of showing a
	 * dead-end toast.
	 */
	const versionMutation = useSaveMutation(
		trpc.updates.runUpdate.mutationOptions({
			onSuccess: (result) => {
				if (result.started) {
					toast.success(result.message);
					setTargetVersion("");
				} else if (result.blockedByDeployments) {
					setBlockedBy(result.activeDeployments ?? 1);
				} else {
					toast.message(result.message);
				}
			},
			onError: (error) => {
				if (/older than/i.test(error.message) && targetVersion) {
					setDowngradeTo(targetVersion);
				}
			},
		}),
		{ invalidate: [statusKey], errorMessage: "Update failed" },
	);

	const data = statusQuery.data;
	const busy =
		settingsMutation.isPending ||
		checkMutation.isPending ||
		applyMutation.isPending ||
		versionMutation.isPending;

	const statusBadge = data?.updateInProgress ? (
		<Badge variant="secondary" className="gap-1.5">
			<Loader2 className="size-3 animate-spin" />
			Updating…
		</Badge>
	) : data?.updateAvailable ? (
		<Badge>Update available</Badge>
	) : data ? (
		<Badge variant="outline">Up to date</Badge>
	) : null;

	return (
		<SettingsSection
			id="updates"
			title="Updates"
			description="Keep this Nixploy host on the latest image."
			actions={
				<div className="flex flex-wrap items-center gap-2">
					{statusBadge}
					{data ? (
						<>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={busy || data.updateInProgress}
								onClick={() => checkMutation.mutate()}
							>
								{checkMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<RefreshCw className="size-4" />
								)}
								Check
							</Button>
							<AlertDialog open={updateOpen} onOpenChange={setUpdateOpen}>
								<AlertDialogTrigger asChild>
									<Button
										type="button"
										size="sm"
										disabled={busy || data.updateInProgress}
										variant={data.updateAvailable ? "default" : "outline"}
									>
										{applyMutation.isPending || data.updateInProgress ? (
											<Loader2 className="size-4 animate-spin" />
										) : null}
										{data.updateAvailable ? "Update" : "Reinstall"}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											{data.updateAvailable ? "Update Nixploy?" : "Reinstall Nixploy image?"}
										</AlertDialogTitle>
										<AlertDialogDescription>
											This pulls {data.targetImage ?? data.image} and rolls the Swarm service. The
											dashboard will briefly disconnect while the new container starts. Your data,
											secrets and certificates are kept. <HelpLink slug="install" />
										</AlertDialogDescription>
									</AlertDialogHeader>
									<PreflightList
										preflight={preflightQuery.data ?? null}
										pending={preflightQuery.isPending || preflightQuery.isFetching}
										error={preflightQuery.error?.message ?? null}
										onRecheck={() => preflightQuery.refetch()}
									/>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											disabled={preflightQuery.isPending || preflightQuery.data?.ok === false}
											onClick={(event) => {
												event.preventDefault();
												setUpdateOpen(false);
												applyMutation.mutate({});
											}}
										>
											{data.updateAvailable ? "Update now" : "Reinstall"}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<AlertDialog
								open={downgradeTo !== null}
								onOpenChange={(open) => {
									if (!open) setDowngradeTo(null);
								}}
							>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Downgrade to {downgradeTo}?</AlertDialogTitle>
										<AlertDialogDescription>
											{downgradeTo} is older than the version running here. Nixploy applies database
											migrations on boot and never reverses them, so the older image may not be able
											to read the current schema. A pre-update database dump is taken first —
											restoring it is the way back. <HelpLink slug="install" />
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Cancel</AlertDialogCancel>
										<AlertDialogAction
											variant="destructive"
											onClick={(event) => {
												event.preventDefault();
												const version = downgradeTo;
												setDowngradeTo(null);
												if (version) {
													versionMutation.mutate({ version, allowDowngrade: true });
												}
											}}
										>
											Downgrade anyway
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
							<AlertDialog
								open={blockedBy !== null}
								onOpenChange={(open) => {
									if (!open) setBlockedBy(null);
								}}
							>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Deployments are running</AlertDialogTitle>
										<AlertDialogDescription>
											{blockedBy ?? 0} deployment{blockedBy === 1 ? " is" : "s are"} in progress.
											Updating now restarts Nixploy and marks {blockedBy === 1 ? "it" : "them"} as
											interrupted. Wait for {blockedBy === 1 ? "it" : "them"} to finish, or update
											anyway.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Wait</AlertDialogCancel>
										<AlertDialogAction
											onClick={(event) => {
												event.preventDefault();
												setBlockedBy(null);
												applyMutation.mutate({ force: true });
											}}
										>
											Update anyway
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</>
					) : null}
				</div>
			}
		>
			{statusQuery.isPending ? (
				<Skeleton className="h-16 w-full" />
			) : statusQuery.error && !data ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">{statusQuery.error.message}</p>
					<Button
						size="sm"
						variant="outline"
						className="w-fit"
						onClick={() => statusQuery.refetch()}
					>
						Retry
					</Button>
				</div>
			) : data ? (
				<>
					{data.updateInProgress ? (
						<p className="text-sm text-muted-foreground">
							Applying update — the dashboard reconnects automatically.
						</p>
					) : (
						<p className="text-sm text-muted-foreground">
							<span className="font-medium text-foreground">v{data.appVersion}</span>
							<span className="mx-1.5 text-border">·</span>
							{formatWhen(data.lastCheckedAt)}
							{data.lastError ? (
								<>
									<span className="mx-1.5 text-border">·</span>
									<span className="text-warning">{data.lastError}</span>
								</>
							) : null}
						</p>
					)}

					{data.releaseNotes ? (
						<div className="rounded-md border">
							<div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
								<div className="flex items-center gap-2 text-sm">
									<span className="font-medium">{data.releaseTag ?? "Latest release"}</span>
									<span className="text-muted-foreground">release notes</span>
								</div>
								<div className="flex items-center gap-1">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => setNotesOpen((open) => !open)}
									>
										{notesOpen ? "Hide" : "Show"}
									</Button>
									{data.releaseUrl ? (
										<Button type="button" size="sm" variant="ghost" asChild>
											<a href={data.releaseUrl} target="_blank" rel="noreferrer noopener">
												<ExternalLink className="size-4" />
												GitHub
											</a>
										</Button>
									) : null}
								</div>
							</div>
							{notesOpen ? (
								<pre className="max-h-72 overflow-auto border-t px-3 py-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
									{data.releaseNotes}
								</pre>
							) : null}
						</div>
					) : null}

					<div className="flex flex-col gap-2">
						<div className="grid gap-0.5">
							<Label htmlFor="target-version">Update to a specific version</Label>
							<p className="text-xs text-muted-foreground">
								Rolls the tracked image to that release tag. Downgrades ask for confirmation —
								database migrations are never reversed. <HelpLink slug="install" />
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Input
								id="target-version"
								className="max-w-40"
								placeholder="1.2.3"
								value={targetVersion}
								disabled={busy || data.updateInProgress}
								onChange={(event) => setTargetVersion(event.target.value)}
							/>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={
									busy || data.updateInProgress || !VERSION_INPUT.test(targetVersion.trim())
								}
								onClick={() => versionMutation.mutate({ version: targetVersion.trim() })}
							>
								{versionMutation.isPending && <Loader2 className="size-4 animate-spin" />}
								Update to {targetVersion.trim() || "…"}
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<div className="grid gap-0.5">
							<Label htmlFor="pinned-version">Pin to a version</Label>
							<p className="text-xs text-muted-foreground">
								Automatic updates never roll past this release. Leave empty to follow the image tag.
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Input
								id="pinned-version"
								className="max-w-40"
								placeholder="No pin"
								value={pin.value}
								disabled={busy}
								onChange={(event) => pin.set(event.target.value)}
							/>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={
									busy ||
									!pin.dirty ||
									(pin.value.trim() !== "" && !VERSION_INPUT.test(pin.value.trim()))
								}
								onClick={() =>
									settingsMutation.mutate({
										pinnedVersion: pin.value.trim() === "" ? null : pin.value.trim(),
									})
								}
							>
								Save pin
							</Button>
							{data.pinnedVersion ? (
								<Button
									type="button"
									size="sm"
									variant="ghost"
									disabled={busy}
									onClick={() => {
										pin.set("");
										settingsMutation.mutate({ pinnedVersion: null });
									}}
								>
									Clear
								</Button>
							) : null}
						</div>
					</div>

					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<Label htmlFor="auto-check">Automatic checks</Label>
							<p className="text-xs text-muted-foreground">
								Periodically look for a newer image. The check schedule runs in UTC.
							</p>
						</div>
						<Switch
							id="auto-check"
							checked={autoCheck}
							disabled={busy}
							onCheckedChange={(checked) => {
								toggles.patch(
									checked ? { autoCheck: true } : { autoCheck: false, autoUpdate: false },
								);
								settingsMutation.mutate({
									autoCheckEnabled: checked,
									...(checked ? {} : { autoUpdateEnabled: false }),
								});
							}}
						/>
					</div>
					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<Label htmlFor="auto-update">Automatic updates</Label>
							<p className="text-xs text-muted-foreground">
								Pull and restart when a newer image is found. <HelpLink slug="install" />
							</p>
						</div>
						<Switch
							id="auto-update"
							checked={autoUpdate}
							disabled={busy || !autoCheck}
							onCheckedChange={(checked) => {
								toggles.patch({ autoUpdate: checked });
								settingsMutation.mutate({ autoUpdateEnabled: checked });
							}}
						/>
					</div>
				</>
			) : null}
		</SettingsSection>
	);
}

/**
 * The preflight checks inside the Update dialog: what the roll cannot recover
 * from blocks the button; what the operator should weigh is shown and left
 * to them. Runs when the dialog opens, re-runs on demand.
 */
function PreflightList({
	preflight,
	pending,
	error,
	onRecheck,
}: {
	preflight: {
		ok: boolean;
		blocks: number;
		warnings: number;
		checks: Array<{
			id: string;
			level: "ok" | "warn" | "block";
			title: string;
			detail: string;
			url?: string | null;
		}>;
	} | null;
	pending: boolean;
	error: string | null;
	onRecheck: () => void;
}) {
	const dot: Record<"ok" | "warn" | "block", string> = {
		ok: "bg-success",
		warn: "bg-warning",
		block: "bg-destructive",
	};
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium">
					{pending && !preflight
						? "Checking the host…"
						: preflight
							? preflight.blocks > 0
								? `${preflight.blocks} check${preflight.blocks === 1 ? "" : "s"} block this update`
								: preflight.warnings > 0
									? `Ready, ${preflight.warnings} warning${preflight.warnings === 1 ? "" : "s"}`
									: "All checks passed"
							: "Preflight"}
				</span>
				<Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onRecheck}>
					{pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
					Re-check
				</Button>
			</div>
			{error ? <p className="text-xs text-destructive">{error}</p> : null}
			{preflight ? (
				<ul className="flex flex-col gap-1.5">
					{preflight.checks.map((check) => (
						<li key={check.id} className="flex items-start gap-2">
							<span
								className={`mt-1.5 size-2 shrink-0 rounded-full ${dot[check.level]}`}
								role="img"
								aria-label={check.level}
							/>
							<span className="min-w-0">
								<span className={check.level === "block" ? "font-medium text-destructive" : ""}>
									{check.title}
								</span>
								{check.detail ? (
									<span className="block text-xs text-muted-foreground">{check.detail}</span>
								) : null}
								{check.url ? (
									<a
										href={check.url}
										target="_blank"
										rel="noreferrer"
										className="block text-xs underline underline-offset-2"
									>
										Read the release notes
									</a>
								) : null}
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
