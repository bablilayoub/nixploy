"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, ExternalLink, GitPullRequest, Loader2, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { useSaveBar } from "@/components/services/save-bar";
import { UnsavedChangesPill } from "@/components/services/unsaved-changes-pill";
import { StatusDot, type StatusDotStatus } from "@/components/shell";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { DisabledHint } from "@/components/ui/disabled-hint";
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
import { Textarea } from "@/components/ui/textarea";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useDraft } from "@/hooks/use-draft";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { useTRPC } from "@/lib/trpc";

import type { Application, PreviewDeployment } from "./types";

const STATUS_CONFIG: Record<
	PreviewDeployment["previewStatus"],
	{ label: string; status: StatusDotStatus }
> = {
	idle: { label: "Idle", status: "neutral" },
	running: { label: "Running", status: "success" },
	done: { label: "Succeeded", status: "info" },
	error: { label: "Error", status: "error" },
	awaiting_approval: { label: "Awaiting approval", status: "warning" },
};

/** Short display form of a commit sha. */
const shortSha = (sha: string): string => sha.slice(0, 7);

/**
 * Attribution line under a preview: who opened the pull request and which
 * commit is deployed. The sha links to the provider's commit page when the
 * webhook could resolve one (self-hosted GitLab/Gitea included — the URL is
 * stored on the row, not guessed in the browser).
 */
function CommitLine({ preview }: { preview: PreviewDeployment }) {
	const author = preview.commitAuthor ?? preview.pullRequestAuthor;
	if (!author && !preview.commitSha) return null;
	return (
		<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
			{author && <span className="truncate">{author}</span>}
			{preview.commitSha &&
				(preview.commitUrl ? (
					<a
						href={preview.commitUrl}
						target="_blank"
						rel="noreferrer"
						className="font-mono hover:underline"
						title={preview.commitSha}
					>
						{shortSha(preview.commitSha)}
					</a>
				) : (
					<span className="font-mono" title={preview.commitSha}>
						{shortSha(preview.commitSha)}
					</span>
				))}
		</span>
	);
}

/** Turn a "expires in N days" input into an absolute date for the API. */
function parseExpiry(days: string): Date | null {
	const parsed = Number.parseInt(days.trim(), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	return new Date(Date.now() + parsed * 24 * 60 * 60 * 1000);
}

export function PreviewDeploymentsTab({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const canDeploy = can("service.deploy");
	const deployHint = canDeploy ? undefined : capabilityHint("service.deploy");
	const applicationId = application.applicationId;

	const [createOpen, setCreateOpen] = useState(false);
	const [prNumber, setPrNumber] = useState("");
	const [branch, setBranch] = useState("");
	const [prTitle, setPrTitle] = useState("");
	const [prUrl, setPrUrl] = useState("");
	const [expiresInDays, setExpiresInDays] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<PreviewDeployment | null>(null);

	const {
		data: previews,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(trpc.previewDeployment.byApplication.queryOptions({ applicationId }));

	const invalidate = [trpc.previewDeployment.byApplication.queryKey({ applicationId })];

	const create = useSaveMutation(
		trpc.previewDeployment.create.mutationOptions({
			onSuccess: () => {
				setCreateOpen(false);
				setPrNumber("");
				setBranch("");
				setPrTitle("");
				setPrUrl("");
				setExpiresInDays("");
			},
		}),
		{ successMessage: "Preview deployment queued", invalidate },
	);

	const remove = useSaveMutation(
		trpc.previewDeployment.delete.mutationOptions({ onSuccess: () => setDeleteTarget(null) }),
		{ successMessage: "Preview deployment deleted", invalidate },
	);

	const approve = useSaveMutation(trpc.previewDeployment.approve.mutationOptions(), {
		successMessage: "Preview approved — deployment queued",
		invalidate,
	});

	const deny = useSaveMutation(trpc.previewDeployment.deny.mutationOptions(), {
		successMessage: "Preview denied and removed",
		invalidate,
	});

	return (
		<SettingsStack>
			<PreviewSettingsCard application={application} />
			<SettingsSection
				title="Preview deployments"
				description="Per-PR preview instances. Enable under Source for git webhooks."
				actions={
					<Dialog open={createOpen} onOpenChange={setCreateOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canDeploy} title={deployHint}>
								<Plus className="size-4" />
								Create preview
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Create preview deployment</DialogTitle>
								<DialogDescription>
									Spins up a variant of this application routed at a wildcard preview domain.
								</DialogDescription>
							</DialogHeader>
							<div className="flex flex-col gap-4">
								<div className="flex flex-col gap-2">
									<Label htmlFor="pr-number">Pull request number</Label>
									<Input
										id="pr-number"
										placeholder="123"
										value={prNumber}
										onChange={(e) => setPrNumber(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="pr-branch">Branch (optional)</Label>
									<Input
										id="pr-branch"
										placeholder="feature/my-branch"
										value={branch}
										onChange={(e) => setBranch(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="pr-title">Title (optional)</Label>
									<Input
										id="pr-title"
										placeholder="Add new feature"
										value={prTitle}
										onChange={(e) => setPrTitle(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="pr-url">Pull Request URL (optional)</Label>
									<Input
										id="pr-url"
										placeholder="https://github.com/org/repo/pull/123"
										value={prUrl}
										onChange={(e) => setPrUrl(e.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="pr-expires">Expires in (days, optional)</Label>
									<Input
										id="pr-expires"
										type="number"
										min={1}
										placeholder="7"
										value={expiresInDays}
										onChange={(e) => setExpiresInDays(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										Nixploy tears the preview down automatically once it expires. Leave empty to
										keep it until the pull request closes or you delete it.
									</p>
								</div>
							</div>
							<DialogFooter>
								<Button
									onClick={() =>
										create.mutate({
											applicationId,
											pullRequestNumber: prNumber.trim(),
											branch: branch.trim() || null,
											pullRequestTitle: prTitle.trim() || null,
											pullRequestURL: prUrl.trim() || null,
											expiresAt: parseExpiry(expiresInDays),
										})
									}
									disabled={!prNumber.trim() || create.isPending}
								>
									{create.isPending && <Loader2 className="size-4 animate-spin" />}
									Create
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				}
			>
				<QueryState
					isPending={isLoading}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!previews || previews.length === 0}
					skeleton={
						<div className="flex flex-col gap-2">
							{["sk-a", "sk-b"].map((id) => (
								<Skeleton key={id} className="h-10 w-full" />
							))}
						</div>
					}
					empty={
						<div className="flex flex-col items-center gap-2 py-10 text-center">
							<GitPullRequest className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No preview deployments. Create one to test a pull request in isolation.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Pull Request</TableHead>
								<TableHead>Branch</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Domain</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(previews ?? []).map((preview) => (
								<TableRow key={preview.previewDeploymentId}>
									<TableCell className="font-medium">
										{preview.pullRequestURL ? (
											<a
												href={preview.pullRequestURL}
												target="_blank"
												rel="noreferrer"
												className="hover:underline"
											>
												#{preview.pullRequestNumber}
											</a>
										) : (
											<>#{preview.pullRequestNumber}</>
										)}
										{/* The head commit's subject is the most useful line here —
										    it says what the preview actually runs. GitHub, Gitea and
										    Bitbucket do not send it on pull-request events, so the PR
										    title stands in for them. */}
										{(preview.commitMessage || preview.pullRequestTitle) && (
											<span
												className="block max-w-64 truncate text-xs text-muted-foreground"
												title={preview.commitMessage ?? preview.pullRequestTitle ?? undefined}
											>
												{preview.commitMessage ?? preview.pullRequestTitle}
											</span>
										)}
										<CommitLine preview={preview} />
									</TableCell>
									<TableCell className="text-muted-foreground">{preview.branch ?? "—"}</TableCell>
									<TableCell>
										<span className="inline-flex items-center gap-1.5 text-sm">
											<StatusDot
												status={(STATUS_CONFIG[preview.previewStatus] ?? STATUS_CONFIG.idle).status}
											/>
											{(STATUS_CONFIG[preview.previewStatus] ?? STATUS_CONFIG.idle).label}
										</span>
									</TableCell>
									<TableCell>
										{preview.domain ? (
											<a
												href={`${preview.domain.https ? "https" : "http"}://${preview.domain.host}`}
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
											>
												{preview.domain.host}
												<ExternalLink className="size-3" />
											</a>
										) : (
											"—"
										)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{format(preview.createdAt, "MMM d, yyyy HH:mm")}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{preview.expiresAt ? format(preview.expiresAt, "MMM d, yyyy HH:mm") : "Never"}
									</TableCell>
									<TableCell className="text-right">
										{preview.previewStatus === "awaiting_approval" ? (
											<div className="flex items-center justify-end gap-1">
												<Button
													variant="outline"
													size="sm"
													disabled={approve.isPending || deny.isPending || !canDeploy}
													title={deployHint}
													onClick={() =>
														approve.mutate({
															previewDeploymentId: preview.previewDeploymentId,
														})
													}
												>
													{approve.isPending ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Check className="size-4" />
													)}
													Approve
												</Button>
												<Button
													variant="ghost"
													size="sm"
													disabled={approve.isPending || deny.isPending || !canDeploy}
													title={deployHint}
													onClick={() =>
														deny.mutate({
															previewDeploymentId: preview.previewDeploymentId,
														})
													}
												>
													<X className="size-4 text-destructive" />
													Deny
												</Button>
											</div>
										) : (
											<Button
												variant="ghost"
												size="sm"
												disabled={!canDeploy}
												title={deployHint}
												onClick={() => setDeleteTarget(preview)}
												aria-label={`Delete preview for PR #${preview.pullRequestNumber}`}
											>
												<Trash2 className="size-4 text-destructive" />
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueryState>

				<AlertDialog
					open={deleteTarget !== null}
					onOpenChange={(open) => !open && setDeleteTarget(null)}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete preview deployment?</AlertDialogTitle>
							<AlertDialogDescription>
								This tears down the preview service for PR #{deleteTarget?.pullRequestNumber},
								removes its route and deletes the record. This cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={(event) => {
									// Keep the dialog open (with its spinner) until the mutation settles.
									event.preventDefault();
									if (deleteTarget) {
										remove.mutate({
											previewDeploymentId: deleteTarget.previewDeploymentId,
										});
									}
								}}
								disabled={remove.isPending}
							>
								{remove.isPending && <Loader2 className="size-4 animate-spin" />}
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</SettingsSection>
		</SettingsStack>
	);
}

/**
 * Preview knobs (product audit, Previews row): a preview-only env layer, the
 * per-application cap the webhook path enforces, and the default TTL stamped
 * on previews created by a pull request.
 */
function PreviewSettingsCard({ application }: { application: Application }) {
	const trpc = useTRPC();
	const { can } = useCapabilities();
	const applicationId = application.applicationId;

	// Background refetches must not wipe what is being typed.
	const draft = useDraft({
		previewEnv: application.previewEnv ?? "",
		limit: String(application.previewLimit ?? 3),
		ttlHours: application.previewTtlHours ? String(application.previewTtlHours) : "",
	});
	const { previewEnv, limit, ttlHours } = draft.value;

	const update = useSaveMutation(trpc.application.update.mutationOptions(), {
		successMessage: "Preview settings saved",
		invalidate: [trpc.application.one.queryKey({ applicationId })],
		onSuccess: draft.markSaved,
	});

	const canWrite = can("service.write") && can("secrets.write");
	const parsedLimit = Number.parseInt(limit, 10);
	const parsedTtl = ttlHours.trim() ? Number.parseInt(ttlHours, 10) : null;
	const limitValid = Number.isFinite(parsedLimit) && parsedLimit >= 0 && parsedLimit <= 100;
	const ttlValid = parsedTtl === null || (Number.isFinite(parsedTtl) && parsedTtl >= 1);

	const onSave = () =>
		update.mutate({
			applicationId,
			previewEnv: previewEnv.trim() || null,
			previewLimit: parsedLimit,
			previewTtlHours: parsedTtl,
		});

	useSaveBar(draft, {
		onSave,
		pending: update.isPending,
		disabled: !canWrite || !limitValid || !ttlValid,
	});

	return (
		<SettingsSection
			title="Preview settings"
			description="Environment overrides, the cap on simultaneous previews, and how long a pull-request preview lives."
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="preview-env">Preview environment variables</Label>
					<Textarea
						id="preview-env"
						className="min-h-24 font-mono text-xs sm:max-w-lg"
						placeholder={"DATABASE_URL=postgres://preview\nSTRIPE_KEY=sk_test_..."}
						value={previewEnv}
						disabled={!canWrite}
						onChange={(event) => draft.patch({ previewEnv: event.target.value })}
					/>
					<p className="text-xs text-muted-foreground">
						Merged over the inherited project, environment and service variables for preview builds
						only — point a preview at a scratch database instead of production.
					</p>
				</div>

				<div className="grid gap-4 sm:max-w-lg sm:grid-cols-2">
					<div className="flex flex-col gap-2">
						<Label htmlFor="preview-limit">Maximum previews</Label>
						<Input
							id="preview-limit"
							inputMode="numeric"
							value={limit}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ limit: event.target.value })}
						/>
						<p className="text-xs text-muted-foreground">0 means no limit.</p>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="preview-ttl">Expire after (hours)</Label>
						<Input
							id="preview-ttl"
							inputMode="numeric"
							placeholder="never"
							value={ttlHours}
							disabled={!canWrite}
							onChange={(event) => draft.patch({ ttlHours: event.target.value })}
						/>
						<p className="text-xs text-muted-foreground">
							Applied when a pull request creates the preview.
						</p>
					</div>
				</div>

				<div className="flex items-center justify-end gap-3">
					<UnsavedChangesPill dirty={draft.dirty} />
					<DisabledHint hint={canWrite ? undefined : capabilityHint("secrets.write")}>
						<Button
							disabled={!canWrite || !limitValid || !ttlValid || update.isPending}
							onClick={onSave}
						>
							{update.isPending && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</DisabledHint>
				</div>
			</div>
		</SettingsSection>
	);
}
