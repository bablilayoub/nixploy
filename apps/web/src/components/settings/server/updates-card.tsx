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
import { describeError } from "@/lib/describe-error";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

/** `1.2.3` / `v1.2.3` — the same shape the server accepts. */
const VERSION_INPUT = /^v?\d+\.\d+\.\d+$/;

type UpdateRequest = { version?: string; allowDowngrade?: boolean };

/** Match the server's parseVersion/releaseTag numeric-component normalization. */
function canonicalVersion(version: string): string {
	return version.replace(/^v/, "").split(".").map(Number).join(".");
}

function versionImage(image: string, version: string): string {
	const base = image.split("@")[0] ?? image;
	const colon = base.lastIndexOf(":");
	const repository = colon > base.lastIndexOf("/") ? base.slice(0, colon) : base;
	return `${repository}:v${canonicalVersion(version)}`;
}

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
	const [updateRequest, setUpdateRequest] = useState<UpdateRequest>({});
	const preflightQuery = useQuery({
		...trpc.updates.preflight.queryOptions(updateRequest),
		enabled: updateOpen,
		staleTime: 0,
	});
	// Deployments in flight when the update was requested; opens the "update anyway?" confirm.
	const [blockedBy, setBlockedBy] = useState<{
		count: number;
		request: UpdateRequest;
	} | null>(null);
	// Keep the selected request separate from the freely typed version draft.
	const [targetVersion, setTargetVersion] = useState("");
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
			onSuccess: (result, request) => {
				if (result.started) {
					toast.success(result.message);
					setUpdateOpen(false);
					if (request?.version) setTargetVersion("");
				} else if (result.blockedByDeployments) {
					setUpdateOpen(false);
					setBlockedBy({ count: result.activeDeployments ?? 1, request: request ?? {} });
				} else {
					toast.message(result.message);
				}
			},
		}),
		{ invalidate: [statusKey] },
	);

	const data = statusQuery.data;
	const busy =
		settingsMutation.isPending ||
		checkMutation.isPending ||
		applyMutation.isPending ||
		data?.updateInProgress;
	const targetImage = data
		? updateRequest.version
			? versionImage(data.image, updateRequest.version)
			: (data.targetImage ?? data.image)
		: "";
	const targetChanged = !!preflightQuery.data && preflightQuery.data.image !== targetImage;
	const canConfirm =
		!busy &&
		preflightQuery.isSuccess &&
		!preflightQuery.isFetching &&
		preflightQuery.data.ok &&
		!targetChanged;

	function openUpdate(request: UpdateRequest) {
		setUpdateRequest(request);
		applyMutation.reset();
		setUpdateOpen(true);
	}

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
							<AlertDialog
								open={updateOpen}
								onOpenChange={(open) => {
									if (applyMutation.isPending) return;
									if (open) openUpdate({});
									else setUpdateOpen(false);
								}}
							>
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
								<AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
									<AlertDialogHeader>
										<AlertDialogTitle>
											{updateRequest.version
												? `Update to v${canonicalVersion(updateRequest.version)}?`
												: data.updateAvailable
													? "Update Nixploy?"
													: "Reinstall Nixploy image?"}
										</AlertDialogTitle>
										<AlertDialogDescription>
											This pulls {targetImage} and rolls the Swarm service. The dashboard will
											briefly disconnect while the new container starts. Your data, secrets and
											certificates are kept. <HelpLink slug="install" />
										</AlertDialogDescription>
									</AlertDialogHeader>
									<PreflightList
										preflight={
											preflightQuery.isError || targetChanged ? null : (preflightQuery.data ?? null)
										}
										pending={preflightQuery.isPending || preflightQuery.isFetching}
										error={
											preflightQuery.error
												? describeError(preflightQuery.error)
												: targetChanged
													? "The update target changed. Re-check before continuing."
													: null
										}
										onRecheck={() => preflightQuery.refetch()}
									/>
									{preflightQuery.data?.checks.some((check) => check.id === "downgrade") ? (
										<div className="flex flex-wrap items-center justify-between gap-4 text-sm">
											<Label htmlFor="allow-downgrade">
												I understand database migrations are never reversed.
											</Label>
											<Switch
												id="allow-downgrade"
												checked={updateRequest.allowDowngrade ?? false}
												disabled={busy || preflightQuery.isFetching}
												onCheckedChange={(allowDowngrade) =>
													setUpdateRequest((request) => ({ ...request, allowDowngrade }))
												}
											/>
										</div>
									) : null}
									{applyMutation.error ? (
										<p role="alert" className="text-sm text-destructive">
											{describeError(applyMutation.error, "Update failed")}
										</p>
									) : null}
									<AlertDialogFooter>
										<AlertDialogCancel disabled={applyMutation.isPending}>Cancel</AlertDialogCancel>
										<AlertDialogAction
											disabled={!canConfirm}
											onClick={(event) => {
												event.preventDefault();
												if (canConfirm) applyMutation.mutate(updateRequest);
											}}
										>
											{applyMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
											{updateRequest.version || data.updateAvailable ? "Update now" : "Reinstall"}
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
											{blockedBy?.count ?? 0} deployment{blockedBy?.count === 1 ? " is" : "s are"}{" "}
											in progress. Updating now restarts Nixploy and marks{" "}
											{blockedBy?.count === 1 ? "it" : "them"} as interrupted. Wait for{" "}
											{blockedBy?.count === 1 ? "it" : "them"} to finish, or update anyway.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Wait</AlertDialogCancel>
										<AlertDialogAction
											onClick={(event) => {
												event.preventDefault();
												const request = blockedBy?.request;
												setBlockedBy(null);
												if (request) {
													setUpdateRequest(request);
													setUpdateOpen(true);
													applyMutation.mutate({ ...request, force: true });
												}
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
								onClick={() => openUpdate({ version: targetVersion.trim() })}
							>
								{applyMutation.isPending && <Loader2 className="size-4 animate-spin" />}
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

					<div className="flex flex-wrap items-center justify-between gap-4">
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
					<div className="flex flex-wrap items-center justify-between gap-4">
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
		<div
			aria-busy={pending}
			className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
		>
			<div className="flex items-center justify-between gap-2">
				<span className="font-medium" role="status">
					{pending
						? "Checking the host…"
						: error
							? "Preflight unavailable"
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
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error} Re-check to try again.
				</p>
			) : null}
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
