"use client";

import type {
	ImportPlan,
	ImportResult,
	SourceInventory,
} from "@nixploy/server/modules/import/index";
import {
	IMPORT_SOURCE_LABELS,
	IMPORT_SOURCES,
	type ImportSource,
} from "@nixploy/server/modules/import/kinds";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileUp, Loader2, LockKeyhole, PlugZap, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTrackedActivity } from "@/components/layout/activity-tray";
import { LoadError } from "@/components/query-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpLink } from "@/components/ui/help-link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCapabilities } from "@/hooks/use-capabilities";
import { describeError, toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";
import { MigrationReview } from "./migration-review";

const selectClass =
	"h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const MAX_DUMP = 512 * 1024 * 1024;

export function MigrationsView() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const { can, isLoading, isError } = useCapabilities({ strict: true });
	const [provider, setProvider] = useState<ImportSource>("dokploy");
	const [mode, setMode] = useState<"live" | "dump">("live");
	const [url, setUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [dump, setDump] = useState<{ dumpId: string; filename: string; expiresAt: string } | null>(
		null,
	);
	const [uploading, setUploading] = useState(false);
	const [inventory, setInventory] = useState<SourceInventory | null>(null);
	const [sourceProjectId, setSourceProjectId] = useState("");
	const [sourceEnvironment, setSourceEnvironment] = useState("");
	const [serviceIds, setServiceIds] = useState<string[]>([]);
	const [projectId, setProjectId] = useState("");
	const [environmentName, setEnvironmentName] = useState("");
	const [keepAppNames, setKeepAppNames] = useState(false);
	const [plan, setPlan] = useState<ImportPlan | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Revision changes synchronously with inputs; a late reply can never become a current plan.
	const revision = useRef(0);
	const inspectRun = useRef(0);
	const planRun = useRef(0);
	const alive = useRef(true);
	const uploadInput = useRef<HTMLInputElement>(null);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			revision.current += 1;
		};
	}, []);
	const inspect = useMutation({ ...trpc.import.inspect.mutationOptions(), gcTime: 0 });
	const makePlan = useMutation({ ...trpc.import.plan.mutationOptions(), gcTime: 0 });
	const apply = useMutation({ ...trpc.import.runApply.mutationOptions(), gcTime: 0 });
	const projects = useQuery({ ...trpc.project.all.queryOptions(), enabled: can("gitops.manage") });
	const busy = uploading || inspect.isPending || makePlan.isPending || apply.isPending;
	useTrackedActivity({
		id: "migration-import",
		kind: "clone",
		label: "Import configuration",
		active: apply.isPending,
	});
	const currentProject = inventory?.projects.find((row) => row.projectId === sourceProjectId);
	const currentEnvironment = currentProject?.environments.find(
		(row) => row.name === sourceEnvironment,
	);
	const clearReview = () => {
		revision.current += 1;
		planRun.current += 1;
		setPlan(null);
		setResult(null);
		setError(null);
		makePlan.reset();
		apply.reset();
	};
	const clearSource = () => {
		clearReview();
		inspectRun.current += 1;
		setUploading(false);
		setInventory(null);
		setDump(null);
		setFile(null);
		setSourceProjectId("");
		setSourceEnvironment("");
		setServiceIds([]);
		setApiKey("");
		inspect.reset();
	};
	const reset = () => {
		clearSource();
		if (uploadInput.current) uploadInput.current.value = "";
		setUrl("");
		setFile(null);
		setProjectId("");
		setEnvironmentName("");
		setKeepAppNames(false);
	};
	const selectEnvironment = (project: SourceInventory["projects"][number], name: string) => {
		clearReview();
		const env = project.environments.find((row) => row.name === name);
		setSourceProjectId(project.projectId);
		setSourceEnvironment(name);
		setEnvironmentName(name);
		setServiceIds(env?.services.map((row) => row.id) ?? []);
	};
	const source = () => ({
		source: provider,
		...(mode === "dump" ? { dumpId: dump?.dumpId } : { url: url.trim(), apiKey: apiKey.trim() }),
	});
	const request = () => ({
		...source(),
		sourceProjectId,
		sourceEnvironmentName: sourceEnvironment,
		projectId: projectId || undefined,
		environmentName: environmentName.trim() || sourceEnvironment,
		keepAppNames: provider === "dokploy" && keepAppNames,
		serviceIds,
	});
	const reportError = (caught: unknown, version: number) => {
		if (!alive.current || revision.current !== version) return;
		setError(describeError(caught));
		toastError(caught);
	};
	const inspectSource = async () => {
		clearReview();
		setInventory(null);
		const version = revision.current;
		const run = ++inspectRun.current;
		try {
			let input = source();
			if (mode === "dump" && !dump) {
				if (!file) return;
				setUploading(true);
				const response = await fetch("/api/import/dump", {
					method: "POST",
					headers: { "content-type": "application/octet-stream", "x-nixploy-filename": file.name },
					body: file,
				});
				const body = await response.json();
				if (!response.ok) throw new Error(body.message || "Could not upload this dump");
				if (!alive.current || version !== revision.current) return;
				setDump(body);
				setUploading(false);
				input = { source: provider, dumpId: body.dumpId };
			}
			const next = await inspect.mutateAsync(input);
			if (!alive.current || version !== revision.current) return;
			setInventory(next);
			const first = next.projects.find((row) => row.environments.length > 0);
			if (first) selectEnvironment(first, first.environments[0]?.name ?? "");
		} catch (caught) {
			reportError(caught, version);
		} finally {
			if (alive.current && run === inspectRun.current) {
				setUploading(false);
				inspect.reset();
			}
		}
	};
	const review = async () => {
		clearReview();
		const version = revision.current;
		const run = ++planRun.current;
		try {
			const next = await makePlan.mutateAsync(request());
			if (alive.current && version === revision.current) setPlan(next);
		} catch (caught) {
			reportError(caught, version);
		} finally {
			if (alive.current && run === planRun.current) makePlan.reset();
		}
	};
	const runApply = async () => {
		if (!plan) return;
		const version = revision.current;
		setError(null);
		try {
			const next = await apply.mutateAsync({ ...request(), reviewToken: plan.reviewToken });
			// Changes must be reflected even if the operator has navigated away.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: trpc.project.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.environment.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.domain.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.application.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.compose.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.postgres.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.mysql.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.mariadb.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.mongo.pathKey() }),
				queryClient.invalidateQueries({ queryKey: trpc.redis.pathKey() }),
			]);
			if (alive.current && version === revision.current) {
				setResult(next);
				inspect.reset();
				makePlan.reset();
				setApiKey("");
				setFile(null);
				if (uploadInput.current) uploadInput.current.value = "";
			}
		} catch (caught) {
			reportError(caught, version);
			if (alive.current && version === revision.current) setPlan(null);
		} finally {
			apply.reset();
		}
	};
	if (isLoading)
		return (
			<div className="space-y-6">
				<Skeleton className="h-16 w-64" />
				<Skeleton className="h-80 w-full" />
			</div>
		);
	if (isError)
		return (
			<LoadError
				title="Could not check migration access"
				message="Reload the page to check your organization capabilities."
				onRetry={() =>
					void queryClient.invalidateQueries({
						queryKey: trpc.organization.myCapabilities.queryKey(),
					})
				}
			/>
		);
	if (!can("gitops.manage"))
		return (
			<div className="space-y-6">
				<PageHeader
					title="Migrations"
					description="Bring existing service configuration into Nixploy."
				/>
				<LoadError
					title="Migration access required"
					message='Ask an organization administrator for the "gitops.manage" capability to inspect and plan an import.'
				/>
			</div>
		);
	return (
		<div className="space-y-6">
			<PageHeader
				title="Migrations"
				description="Move service configuration from an existing panel, review the changes, then choose when to deploy."
				actions={
					<>
						<HelpLink slug="migrate" label="Migration guide" />
						<Button variant="outline" disabled={apply.isPending} onClick={reset}>
							<RotateCcw className="size-4" />
							Start over
						</Button>
					</>
				}
			/>
			<div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
				<LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<p className="text-muted-foreground">
					Dokploy and Coolify live APIs are supported; database dumps are supported for Dokploy.
					Imports copy configuration and readable environment values. Database data, persistent
					files and encrypted source secrets need separate restoration. Source API keys stay in this
					page's memory and are cleared when you change the source, finish or leave.
				</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>1. Connect your source</CardTitle>
					<CardDescription>
						Use a source API key with read access. Coolify also needs API access enabled and
						read:sensitive to copy environment values and raw Compose content. Dokploy supports
						PostgreSQL dump uploads.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="max-w-sm space-y-2">
						<Label htmlFor="migration-provider">Source panel</Label>
						<select
							id="migration-provider"
							className={selectClass}
							value={provider}
							disabled={apply.isPending}
							onChange={(event) => {
								clearSource();
								setProvider(event.target.value as ImportSource);
								setMode("live");
							}}
						>
							{IMPORT_SOURCES.map((value) => (
								<option key={value} value={value}>
									{IMPORT_SOURCE_LABELS[value]}
								</option>
							))}
						</select>
					</div>
					<fieldset disabled={busy} className="flex flex-wrap gap-2">
						<legend className="sr-only">Source connection</legend>
						<Button
							type="button"
							variant={mode === "live" ? "default" : "outline"}
							aria-pressed={mode === "live"}
							onClick={() => {
								clearSource();
								setMode("live");
							}}
						>
							<PlugZap className="size-4" />
							Live API
						</Button>
						<Button
							type="button"
							variant={mode === "dump" ? "default" : "outline"}
							disabled={provider !== "dokploy"}
							aria-pressed={mode === "dump"}
							onClick={() => {
								clearSource();
								setMode("dump");
							}}
						>
							<FileUp className="size-4" />
							Upload dump
						</Button>
					</fieldset>
					{mode === "live" ? (
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="migration-url">Source panel URL</Label>
								<Input
									id="migration-url"
									type="url"
									placeholder="https://panel.example.com"
									value={url}
									disabled={apply.isPending}
									onChange={(event) => {
										clearSource();
										setUrl(event.target.value);
									}}
									autoComplete="off"
								/>
								<p className="text-xs text-muted-foreground">
									Private addresses require the instance's private-egress setting.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="migration-key">Source API key</Label>
								<Input
									id="migration-key"
									type="password"
									value={apiKey}
									disabled={apply.isPending}
									onChange={(event) => {
										clearSource();
										setApiKey(event.target.value);
									}}
									autoComplete="off"
								/>
								<p className="text-xs text-muted-foreground">
									Sent in request bodies; never saved in the browser or reports.
								</p>
							</div>
						</div>
					) : (
						<div className="space-y-2">
							<Label htmlFor="migration-file">PostgreSQL dump</Label>
							<Input
								id="migration-file"
								ref={uploadInput}
								type="file"
								accept=".sql,.dump,.backup,.gz"
								disabled={busy}
								onChange={(event) => {
									clearSource();
									const next = event.target.files?.[0] ?? null;
									if (next && next.size > MAX_DUMP) {
										setFile(null);
										setError("The dump exceeds 512 MiB.");
									} else setFile(next);
								}}
							/>
							<p className="text-xs text-muted-foreground">
								SQL or pg_dump custom format, optionally gzip, up to 512 MiB. Uploaded dumps are
								organization-scoped and expire after 24 hours.
							</p>
							{dump && (
								<p className="text-xs text-muted-foreground">
									Uploaded {dump.filename}. Expires {new Date(dump.expiresAt).toLocaleString()}.
									reupload after expiry.
								</p>
							)}
						</div>
					)}
					<Button
						disabled={busy || (mode === "live" ? !url.trim() || !apiKey.trim() : !file && !dump)}
						onClick={() => void inspectSource()}
					>
						{inspect.isPending || uploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<ArrowRight className="size-4" />
						)}
						{uploading
							? "Uploading dump…"
							: inspect.isPending
								? "Inspecting source…"
								: "Inspect source"}
					</Button>
				</CardContent>
			</Card>
			{error && (
				<div
					role="alert"
					className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
				>
					{error} Correct the input or retry the relevant step.
				</div>
			)}
			{inventory && (
				<Card>
					<CardHeader>
						<CardTitle>2. Choose configuration and target</CardTitle>
						<CardDescription className="break-all">
							Inventory from {inventory.host}. Select one source environment per import.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						{inventory.projects.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								No projects are visible to this source key. Check its permissions, then inspect
								again.
							</p>
						) : (
							<>
								<div className="grid gap-4 sm:grid-cols-2">
									<div className="space-y-2">
										<Label htmlFor="migration-project">Source project</Label>
										<select
											id="migration-project"
											className={selectClass}
											value={sourceProjectId}
											disabled={apply.isPending}
											onChange={(event) => {
												const next = inventory.projects.find(
													(row) => row.projectId === event.target.value,
												);
												if (next) selectEnvironment(next, next.environments[0]?.name ?? "");
											}}
										>
											<option value="" disabled>
												Choose a project
											</option>
											{inventory.projects.map((row) => (
												<option key={row.projectId} value={row.projectId}>
													{row.name}
												</option>
											))}
										</select>
									</div>
									<div className="space-y-2">
										<Label htmlFor="migration-environment">Source environment</Label>
										<select
											id="migration-environment"
											className={selectClass}
											value={sourceEnvironment}
											disabled={apply.isPending || !currentProject?.environments.length}
											onChange={(event) => {
												if (currentProject) selectEnvironment(currentProject, event.target.value);
											}}
										>
											<option value="" disabled>
												Choose an environment
											</option>
											{currentProject?.environments.map((row) => (
												<option key={row.name} value={row.name}>
													{row.name}
												</option>
											))}
										</select>
									</div>
								</div>
								{currentEnvironment && (
									<section className="space-y-2">
										<div className="flex items-center justify-between gap-3">
											<h3 className="text-sm font-medium">
												Services{" "}
												<span className="text-muted-foreground tabular-nums">
													{serviceIds.length} of {currentEnvironment.services.length}
												</span>
											</h3>
											<Button
												size="sm"
												variant="ghost"
												disabled={apply.isPending}
												onClick={() => {
													clearReview();
													setServiceIds(
														serviceIds.length === currentEnvironment.services.length
															? []
															: currentEnvironment.services.map((row) => row.id),
													);
												}}
											>
												{serviceIds.length === currentEnvironment.services.length
													? "Deselect all"
													: "Select all"}
											</Button>
										</div>
										{currentEnvironment.services.length === 0 ? (
											<p className="text-sm text-muted-foreground">
												This environment has no supported services.
											</p>
										) : (
											<div className="grid max-h-64 gap-px overflow-auto rounded-md border bg-border sm:grid-cols-2">
												{currentEnvironment.services.map((row) => (
													<label
														htmlFor={`migration-service-${row.id}`}
														key={row.id}
														className="flex min-w-0 cursor-pointer items-center gap-3 bg-card px-3 py-3 text-sm"
													>
														<Checkbox
															id={`migration-service-${row.id}`}
															checked={serviceIds.includes(row.id)}
															disabled={apply.isPending}
															onCheckedChange={(checked) => {
																clearReview();
																setServiceIds((current) =>
																	checked
																		? [...current, row.id]
																		: current.filter((id) => id !== row.id),
																);
															}}
														/>
														<span className="min-w-0 break-words">
															{row.name}
															<span className="ms-2 text-xs text-muted-foreground">{row.kind}</span>
														</span>
													</label>
												))}
											</div>
										)}
										{currentEnvironment.unsupported > 0 && (
											<p className="text-sm text-warning">
												{currentEnvironment.unsupported} unsupported resource(s) will be skipped and
												explained in the plan.
											</p>
										)}
									</section>
								)}
								{projects.isError ? (
									<LoadError
										title="Could not load target projects"
										message="Retry to load the projects you can access."
										onRetry={() => void projects.refetch()}
									/>
								) : (
									<div className="grid gap-4 sm:grid-cols-2">
										<div className="space-y-2">
											<Label htmlFor="migration-target">Target project</Label>
											<select
												id="migration-target"
												className={selectClass}
												value={projectId}
												disabled={apply.isPending || projects.isPending}
												onChange={(event) => {
													clearReview();
													setProjectId(event.target.value);
												}}
											>
												<option value="">Match source project name, or create it</option>
												{projects.data?.map((row) => (
													<option key={row.projectId} value={row.projectId}>
														{row.name}
													</option>
												))}
											</select>
											<p className="text-xs text-muted-foreground">
												Only projects visible to your organization and teams are listed.
											</p>
										</div>
										<div className="space-y-2">
											<Label htmlFor="migration-target-environment">Target environment name</Label>
											<Input
												id="migration-target-environment"
												value={environmentName}
												maxLength={255}
												disabled={apply.isPending}
												onChange={(event) => {
													clearReview();
													setEnvironmentName(event.target.value);
												}}
											/>
											<p className="text-xs text-muted-foreground">
												An existing name is updated; a missing environment is created.
											</p>
										</div>
									</div>
								)}
								{provider === "dokploy" && (
									<label htmlFor="migration-keep-names" className="flex items-start gap-3 text-sm">
										<Checkbox
											id="migration-keep-names"
											checked={keepAppNames}
											disabled={apply.isPending}
											onCheckedChange={(checked) => {
												clearReview();
												setKeepAppNames(checked === true);
											}}
											className="mt-0.5"
										/>
										<span>
											Keep source runtime names
											<span className="mt-1 block text-xs text-muted-foreground">
												Use only when you intend to reuse those names. Collisions are reported. This
												does not move containers or volumes.
											</span>
										</span>
									</label>
								)}
								<Button
									disabled={
										busy ||
										projects.isPending ||
										projects.isError ||
										!sourceProjectId ||
										!sourceEnvironment ||
										!serviceIds.length ||
										!environmentName.trim() ||
										(mode === "live" && !apiKey)
									}
									onClick={() => void review()}
								>
									{makePlan.isPending ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<ArrowRight className="size-4" />
									)}
									{makePlan.isPending ? "Preparing plan…" : "Review import plan"}
								</Button>
							</>
						)}
					</CardContent>
				</Card>
			)}
			{plan && (
				<MigrationReview
					key={plan.reviewToken}
					plan={plan}
					result={result}
					pending={apply.isPending}
					can={can}
					onApply={() => void runApply()}
					onReplan={() => {
						clearReview();
						if (mode === "live")
							setError("Re-enter the source API key above, inspect and generate a fresh plan.");
						else void review();
					}}
				/>
			)}
		</div>
	);
}
