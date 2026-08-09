"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
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
import { useTRPC } from "@/lib/trpc";

type PlanItem = {
	kind: string;
	action: "create" | "update" | "delete" | "noop";
	name: string;
	environment: string;
	parent?: string;
	changes?: string[];
};

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
			anchor.click();
			URL.revokeObjectURL(url);
			toast.success("Stack exported");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Export failed");
		}
	};

	useImperativeHandle(ref, () => ({
		exportStack: handleExport,
	}));

	const handlePreview = async () => {
		if (!yaml.trim()) {
			toast.error("Paste or upload a stack file first");
			return;
		}
		try {
			await planMutation.mutateAsync({ yaml, projectId });
			setConfirmOpen(true);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Plan failed");
		}
	};

	const handleApply = async () => {
		try {
			const result = await applyMutation.mutateAsync({
				yaml,
				projectId,
				redeploy: redeployAfter,
			});
			const redeployed = result.redeploy?.deploymentIds.length ?? 0;
			toast.success(
				redeployed > 0
					? `Applied ${result.applied} change(s), queued ${redeployed} redeploy(s)`
					: `Applied ${result.applied} change(s)`,
			);
			setConfirmOpen(false);
			onImportOpenChange(false);
			setYaml("");
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.project.one.queryKey({ projectId }) }),
				queryClient.invalidateQueries({
					queryKey: trpc.application.all.queryKey({ projectId, environmentName }),
				}),
				queryClient.invalidateQueries({
					queryKey: trpc.compose.all.queryKey({ projectId, environmentName }),
				}),
			]);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Apply failed");
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
			const redeployed = result.redeploy?.deploymentIds.length ?? 0;
			toast.success(
				redeployed > 0
					? `Synced ${result.applied} change(s), queued ${redeployed} redeploy(s)`
					: `Synced ${result.applied} change(s)`,
			);
			onImportOpenChange(false);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.project.one.queryKey({ projectId }) }),
				queryClient.invalidateQueries({
					queryKey: trpc.application.all.queryKey({ projectId, environmentName }),
				}),
				queryClient.invalidateQueries({
					queryKey: trpc.compose.all.queryKey({ projectId, environmentName }),
				}),
			]);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Sync failed");
		}
	};

	const planItems = (planMutation.data?.items ?? []) as PlanItem[];

	return (
		<>
			<Dialog open={importOpen} onOpenChange={onImportOpenChange}>
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
						<Button variant="outline" onClick={() => onImportOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={() => void handlePreview()} disabled={planMutation.isPending}>
							Preview plan
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
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
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmOpen(false)}>
							Cancel
						</Button>
						<Button onClick={() => void handleApply()} disabled={applyMutation.isPending}>
							Confirm apply
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
});
