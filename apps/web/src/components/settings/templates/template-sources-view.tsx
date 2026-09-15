"use client";

import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle, LayoutGrid, Loader2, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { SettingsSection } from "@/components/layout/settings-section";
import { QueryState } from "@/components/query-state";
import { PageHeader } from "@/components/shell";
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
import { Badge } from "@/components/ui/badge";
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
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSaveMutation } from "@/hooks/use-save-mutation";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

type SourceRow = inferRouterOutputs<AppRouter>["template"]["sourcesList"][number];
type SourceKind = "git" | "http-json";

const KIND_LABEL: Record<SourceKind, string> = {
	"http-json": "JSON index",
	git: "Git repository",
};

/**
 * Remote template catalogs (product audit, Platform row "Templates are a fixed
 * TS catalog"). Org admins point Nixploy at a JSON index or a git repository;
 * a sync validates every entry and caches it, and the gallery merges the cache
 * in with a source badge.
 */
export function TemplateSourcesView() {
	const trpc = useTRPC();
	const { role } = useCapabilities();
	// Managing sources is an org-admin action: a source's compose bodies
	// become deployable templates for the whole organization.
	const canManage = role === "admin" || role === "owner";
	const manageHint = canManage ? undefined : "Requires the admin or owner role";

	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [kind, setKind] = useState<SourceKind>("http-json");
	const [branch, setBranch] = useState("");
	const [removing, setRemoving] = useState<SourceRow | null>(null);
	const [syncingId, setSyncingId] = useState<string | null>(null);

	const {
		data: sources,
		isPending,
		isError,
		error,
		refetch,
	} = useQuery(trpc.template.sourcesList.queryOptions());

	const listKey = trpc.template.sourcesList.queryKey();
	const invalidate = [listKey, trpc.template.all.queryKey()];

	const createMutation = useSaveMutation(trpc.template.sourcesCreate.mutationOptions(), {
		successMessage: "Template source added",
		invalidate,
		onSuccess: () => {
			setOpen(false);
			setName("");
			setUrl("");
			setKind("http-json");
			setBranch("");
		},
	});

	const updateMutation = useSaveMutation(trpc.template.sourcesUpdate.mutationOptions(), {
		successMessage: "Template source updated",
		invalidate,
	});

	const deleteMutation = useSaveMutation(trpc.template.sourcesDelete.mutationOptions(), {
		successMessage: "Template source removed",
		invalidate,
		onSuccess: () => setRemoving(null),
	});

	const syncMutation = useSaveMutation(trpc.template.sourcesSync.mutationOptions(), {
		successMessage: "Template source synced",
		invalidate,
		onSuccess: () => setSyncingId(null),
		errorMessage: "Sync failed",
	});

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Templates"
				description="Bring your own template catalogs alongside the built-in ones."
			/>
			<SettingsSection
				wide
				title={
					<span className="flex items-center gap-2">
						<LayoutGrid className="size-4 text-muted-foreground" />
						Template sources
					</span>
				}
				description="A JSON index or a git repository of templates. Entries are validated and their images probed on every sync. Nothing is fetched while browsing the gallery."
				actions={
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button size="sm" disabled={!canManage} title={manageHint}>
								<Plus className="size-4" />
								Add source
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Add template source</DialogTitle>
								<DialogDescription>
									Templates use the same shape as the built-in catalog.{" "}
									<HelpLink slug="templates" />
								</DialogDescription>
							</DialogHeader>
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label htmlFor="source-name">Name</Label>
									<Input
										id="source-name"
										placeholder="e.g. Platform team catalog"
										value={name}
										onChange={(event) => setName(event.target.value)}
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="source-kind">Kind</Label>
									<Select value={kind} onValueChange={(value) => setKind(value as SourceKind)}>
										<SelectTrigger id="source-kind">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="http-json">JSON index</SelectItem>
											<SelectItem value="git">Git repository</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="source-url">URL</Label>
									<Input
										id="source-url"
										placeholder={
											kind === "git"
												? "https://github.com/acme/templates.git"
												: "https://templates.example.com/index.json"
										}
										value={url}
										onChange={(event) => setUrl(event.target.value)}
									/>
									<p className="text-xs text-muted-foreground">
										{kind === "git"
											? "The repository must carry templates/index.json."
											: "A JSON array of templates, or an object with a templates array."}
									</p>
								</div>
								{kind === "git" ? (
									<div className="grid gap-2">
										<Label htmlFor="source-branch">Branch (optional)</Label>
										<Input
											id="source-branch"
											placeholder="Default branch"
											value={branch}
											onChange={(event) => setBranch(event.target.value)}
										/>
									</div>
								) : null}
							</div>
							<DialogFooter>
								<Button
									type="button"
									disabled={!name.trim() || !url.trim() || createMutation.isPending}
									onClick={() =>
										createMutation.mutate({
											name: name.trim(),
											url: url.trim(),
											kind,
											branch: kind === "git" && branch.trim() ? branch.trim() : null,
										})
									}
								>
									{createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
									Add source
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				}
			>
				<QueryState
					isPending={isPending}
					isError={isError}
					error={error}
					onRetry={() => refetch()}
					isEmpty={!sources || sources.length === 0}
					empty={
						<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
							<LayoutGrid className="size-8 text-muted-foreground" />
							<p className="text-sm font-medium">No template sources</p>
							<p className="text-sm text-muted-foreground">
								Add one to publish your own templates next to the built-in catalog.
							</p>
						</div>
					}
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Source</TableHead>
								<TableHead>Templates</TableHead>
								<TableHead>Last sync</TableHead>
								<TableHead>Enabled</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(sources ?? []).map((source) => (
								<TableRow key={source.templateSourceId}>
									<TableCell>
										<div className="flex flex-col">
											<span className="font-medium">{source.name}</span>
											{source.lastError ? (
												<span className="flex items-center gap-1 text-xs text-destructive">
													<AlertTriangle className="size-3" />
													{source.lastError}
												</span>
											) : null}
											{source.report && source.report.rejected.length > 0 ? (
												<span className="text-xs text-warning">
													{source.report.rejected.length} entr
													{source.report.rejected.length === 1 ? "y" : "ies"} rejected:{" "}
													{source.report.rejected.slice(0, 2).join("; ")}
												</span>
											) : null}
											{source.report && source.report.imageWarnings.length > 0 ? (
												<span className="text-xs text-muted-foreground">
													{source.report.imageWarnings.length} image
													{source.report.imageWarnings.length === 1 ? "" : "s"} could not be
													verified
												</span>
											) : null}
										</div>
									</TableCell>
									<TableCell className="max-w-72">
										<div className="flex flex-col">
											<Badge variant="outline" className="w-fit">
												{KIND_LABEL[source.kind]}
											</Badge>
											<span className="truncate font-mono text-xs text-muted-foreground">
												{source.url}
												{source.branch ? ` (${source.branch})` : ""}
											</span>
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground">{source.templateCount}</TableCell>
									<TableCell className="text-muted-foreground">
										{source.lastSyncAt ? formatRelative(source.lastSyncAt) : "Never"}
									</TableCell>
									<TableCell>
										<Switch
											checked={source.enabled}
											disabled={!canManage || updateMutation.isPending}
											aria-label="Enabled"
											onCheckedChange={(checked) =>
												updateMutation.mutate({
													templateSourceId: source.templateSourceId,
													enabled: checked,
												})
											}
										/>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												disabled={!canManage || syncMutation.isPending}
												title={manageHint}
												onClick={() => {
													setSyncingId(source.templateSourceId);
													syncMutation.mutate({
														templateSourceId: source.templateSourceId,
													});
												}}
											>
												{syncMutation.isPending && syncingId === source.templateSourceId ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<RefreshCw className="size-4" />
												)}
												Sync now
											</Button>
											<Button
												variant="ghost"
												size="sm"
												disabled={!canManage}
												title={manageHint}
												onClick={() => setRemoving(source)}
											>
												Remove
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</QueryState>
			</SettingsSection>

			<AlertDialog open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove template source?</AlertDialogTitle>
						<AlertDialogDescription>
							Templates from “{removing?.name ?? ""}” disappear from the gallery. Services already
							deployed from them are untouched.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={(event) => {
								event.preventDefault();
								if (removing) {
									deleteMutation.mutate({ templateSourceId: removing.templateSourceId });
								}
							}}
						>
							{deleteMutation.isPending && <Loader2 className="size-4 animate-spin" />}
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
