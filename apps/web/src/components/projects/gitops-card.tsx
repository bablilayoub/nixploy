"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, Zap } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

type PlanItem = {
	kind: string;
	action: "create" | "update" | "delete" | "noop";
	name: string;
	environment: string;
	parent?: string;
	changes?: string[];
};

/** One service the server could not apply; the rest of the stack was still written. */
type ApplyError = { kind: string; name: string; message: string };

function ApplyErrorList({ errors }: { errors: ApplyError[] }) {
	if (errors.length === 0) return null;
	return (
		<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
			<p className="font-medium text-destructive">
				{errors.length === 1
					? "1 service could not be applied"
					: `${errors.length} services could not be applied`}
			</p>
			<p className="text-muted-foreground text-xs">
				The remaining services were applied; failed ones were not redeployed. Fix the stack and
				apply again.
			</p>
			<ul className="mt-2 space-y-1">
				{errors.map((error) => (
					<li key={`${error.kind}-${error.name}`} className="flex flex-col gap-0.5">
						<span className="font-medium">
							{error.kind}: {error.name}
						</span>
						<span className="text-muted-foreground text-xs">{error.message}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

export type GitopsCardHandle = {
	exportStack: () => Promise<void>;
};

/**
 * GitOps import/apply dialogs. Mount outside DropdownMenuContent so the menu
 * closing does not unmount the dialog. Menu items live in EnvironmentActions.
 */
export const GitopsCard = forwardRef<
	GitopsCardHandle,
	{
		projectId: string;
		environmentName: string;
		importOpen: boolean;
		onImportOpenChange: (open: boolean) => void;
	}
>(function GitopsCard({ projectId, environmentName, importOpen, onImportOpenChange }, ref) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [yaml, setYaml] = useState("");
	const [stackUrl, setStackUrl] = useState("");
	const [redeployAfter, setRedeployAfter] = useState(true);
	const [confirmOpen, setConfirmOpen] = useState(false);
	// Partial applies resolve (they no longer throw): the dialog that started
	// the apply stays open and lists what failed instead of closing on success.
	const [applyErrors, setApplyErrors] = useState<ApplyError[]>([]);
	const [syncErrors, setSyncErrors] = useState<ApplyError[]>([]);

	const closeImport = (open: boolean) => {
		if (!open) setSyncErrors([]);
		onImportOpenChange(open);
	};
	const closeConfirm = (open: boolean) => {
		if (!open) setApplyErrors([]);
		setConfirmOpen(open);
	};

	const reportApply = (
		verb: "Applied" | "Synced",
		result: { applied: number; errors: ApplyError[]; redeploy: { deploymentIds: string[] } | null },
	) => {
		const redeployed = result.redeploy?.deploymentIds.length ?? 0;
		const summary =
			redeployed > 0
				? `${verb} ${result.applied} change(s), queued ${redeployed} redeploy(s)`
				: `${verb} ${result.applied} change(s)`;
		if (result.errors.length > 0) {
			toast.warning(`${summary} — ${result.errors.length} failed`);
		} else {
			toast.success(summary);
		}
	};

	const exportQuery = useQuery({
		...trpc.gitops.exportStack.queryOptions({
			projectId,
			environmentName,
			asYaml: true,
		}),
		enabled: false,
	});

	const planMutation = useMutation(trpc.gitops.plan.mutationOptions());
	const applyMutation = useMutation(trpc.gitops.runApply.mutationOptions());
	const syncUrlMutation = useMutation(trpc.gitops.syncFromUrl.mutationOptions());
	// Same call a Git-driven pipeline makes: apply the YAML immediately, no plan.
	const syncGitMutation = useMutation(trpc.gitops.syncFromGit.mutationOptions());

	const handleExport = async () => {
		try {
			const result = await exportQuery.refetch();
			const yamlContent = result.data?.yaml;
			if (!yamlContent) {
				throw new Error("Export returned no YAML");
			}
			const blob = new Blob([yamlContent], { type: "text/yaml" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `nixploy-${environmentName}.yaml`;
			// Firefox/Safari need the anchor in the document and abort the download
			// when the blob URL is revoked synchronously after click().
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			toast.success("Stack exported");
		} catch (error) {
			toastError(error, "Export failed");
		}
	};

	useImperativeHandle(ref, () => ({
		exportStack: handleExport,
	}));

	/**
	 * A stack can add/remove environments and any service type, so refresh the
	 * environment strip, the project rows/counts and every service list — not
	 * only applications and compose.
	 */
	const invalidateAfterApply = async () => {
		const serviceInput = { projectId, environmentName };
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.project.one.queryKey({ projectId }) }),
			queryClient.invalidateQueries({ queryKey: trpc.project.all.queryKey() }),
			queryClient.invalidateQueries({
				queryKey: trpc.environment.byProject.queryKey({ projectId }),
			}),
			queryClient.invalidateQueries({ queryKey: trpc.application.all.queryKey(serviceInput) }),
			queryClient.invalidateQueries({ queryKey: trpc.compose.all.queryKey(serviceInput) }),
			queryClient.invalidateQueries({ queryKey: trpc.postgres.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.mysql.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.mariadb.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.mongo.all.pathKey() }),
			queryClient.invalidateQueries({ queryKey: trpc.redis.all.pathKey() }),
		]);
	};

	const handlePreview = async () => {
		if (!yaml.trim()) {
			toast.error("Paste or upload a stack file first");
			return;
		}
		try {
			await planMutation.mutateAsync({ yaml, projectId });
			setConfirmOpen(true);
		} catch (error) {
			toastError(error, "Plan failed");
		}
	};

	const handleApply = async () => {
		try {
			const result = await applyMutation.mutateAsync({
				yaml,
				projectId,
				redeploy: redeployAfter,
			});
			reportApply("Applied", result);
			if (result.errors.length > 0) {
				// Keep both dialogs (and the YAML) so the user can read the failures
				// and re-apply after fixing the stack.
				setApplyErrors(result.errors);
			} else {
				setApplyErrors([]);
				setConfirmOpen(false);
				onImportOpenChange(false);
				setYaml("");
			}
			await invalidateAfterApply();
		} catch (error) {
			toastError(error, "Apply failed");
		}
	};

	const handleSyncUrl = async () => {
		if (!stackUrl.trim()) {
			toast.error("Enter an https URL to a raw nixploy.yaml");
			return;
		}
		try {
			const result = await syncUrlMutation.mutateAsync({
				url: stackUrl.trim(),
				projectId,
				redeploy: redeployAfter,
			});
			reportApply("Synced", result);
			if (result.errors.length > 0) {
				setSyncErrors(result.errors);
			} else {
				setSyncErrors([]);
				onImportOpenChange(false);
			}
			await invalidateAfterApply();
		} catch (error) {
			toastError(error, "Sync failed");
		}
	};

	const handleSyncFromGit = async () => {
		if (!yaml.trim()) {
			toast.error("Paste or upload a stack file first");
			return;
		}
		try {
			const result = await syncGitMutation.mutateAsync({
				yaml,
				projectId,
				redeploy: redeployAfter,
			});
			reportApply("Synced", result);
			if (result.errors.length > 0) {
				setSyncErrors(result.errors);
			} else {
				setSyncErrors([]);
				onImportOpenChange(false);
				setYaml("");
			}
			await invalidateAfterApply();
		} catch (error) {
			toastError(error, "Sync failed");
		}
	};

	const planItems = (planMutation.data?.items ?? []) as PlanItem[];

	return (
		<>
			<Dialog open={importOpen} onOpenChange={closeImport}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Import stack</DialogTitle>
						<DialogDescription>
							Paste or upload a nixploy.yaml for{" "}
							<span className="font-medium">{environmentName}</span>. Secrets are not stored in the
							file — only env variable names are referenced.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-3">
						<div className="grid gap-2">
							<Label htmlFor="gitops-url">Sync from URL</Label>
							<div className="flex flex-wrap gap-2">
								<Input
									id="gitops-url"
									value={stackUrl}
									onChange={(event) => setStackUrl(event.target.value)}
									placeholder="https://raw.githubusercontent.com/org/repo/main/nixploy.yaml"
									className="font-mono text-xs"
								/>
								<Button
									type="button"
									variant="secondary"
									disabled={syncUrlMutation.isPending}
									onClick={() => void handleSyncUrl()}
								>
									<Link2 className="size-4" />
									Pull & apply
								</Button>
							</div>
							<p className="text-muted-foreground text-xs">
								HTTPS raw file only. Applies the stack and redeploys changed apps/compose by
								default.
							</p>
							<ApplyErrorList errors={syncErrors} />
						</div>
						<div className="flex items-center gap-2">
							<input
								ref={fileInputRef}
								type="file"
								accept=".yaml,.yml,.json"
								className="hidden"
								onChange={async (event) => {
									const file = event.target.files?.[0];
									if (!file) return;
									setYaml(await file.text());
									event.target.value = "";
								}}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => fileInputRef.current?.click()}
							>
								Upload file
							</Button>
							<label className="text-muted-foreground flex items-center gap-2 text-xs">
								<input
									type="checkbox"
									checked={redeployAfter}
									onChange={(event) => setRedeployAfter(event.target.checked)}
								/>
								Redeploy changed services after apply
							</label>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="gitops-yaml">Stack YAML</Label>
							<Textarea
								id="gitops-yaml"
								value={yaml}
								onChange={(event) => setYaml(event.target.value)}
								placeholder="version: 1&#10;project:&#10;  name: my-project"
								className="min-h-48 font-mono text-xs"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => closeImport(false)}>
							Cancel
						</Button>
						<Button
							variant="secondary"
							onClick={() => void handleSyncFromGit()}
							disabled={syncGitMutation.isPending || planMutation.isPending}
							title="Apply the pasted stack right away (gitops.syncFromGit), skipping the plan preview"
						>
							{syncGitMutation.isPending ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Zap className="size-4" />
							)}
							Sync from Git
						</Button>
						<Button
							onClick={() => void handlePreview()}
							disabled={planMutation.isPending || syncGitMutation.isPending}
						>
							Preview plan
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={confirmOpen} onOpenChange={closeConfirm}>
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>Apply stack?</DialogTitle>
						<DialogDescription>
							{planMutation.data
								? `${planMutation.data.summary.create} create, ${planMutation.data.summary.update} update, ${planMutation.data.summary.delete} delete, ${planMutation.data.summary.noop} unchanged`
								: "Review planned changes before applying."}
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
						{planItems.length === 0 ? (
							<p className="text-sm text-muted-foreground">No changes detected.</p>
						) : (
							planItems
								.filter((item) => item.action !== "noop")
								.map((item) => (
									<div
										key={`${item.kind}-${item.parent ?? ""}-${item.name}`}
										className="flex items-center gap-2 text-sm"
									>
										<Badge
											variant={
												item.action === "create"
													? "default"
													: item.action === "delete"
														? "destructive"
														: "secondary"
											}
										>
											{item.action}
										</Badge>
										<span>
											{item.kind}
											{item.parent ? ` (${item.parent})` : ""}: {item.name}
										</span>
									</div>
								))
						)}
					</div>
					<ApplyErrorList errors={applyErrors} />
					<DialogFooter>
						<Button variant="outline" onClick={() => closeConfirm(false)}>
							{applyErrors.length > 0 ? "Close" : "Cancel"}
						</Button>
						<Button onClick={() => void handleApply()} disabled={applyMutation.isPending}>
							{applyMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							{applyErrors.length > 0 ? "Apply again" : "Confirm apply"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
});
