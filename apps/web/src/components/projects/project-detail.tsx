"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FolderGit2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { RecoveryCopies } from "@/components/backups/recovery-copies";
import { LoadError } from "@/components/query-state";
import { capabilityHint } from "@/components/services/capability-hint";
import { EmptyState } from "@/components/services/empty-state";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import { confirmDiscardUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { describeError } from "@/lib/describe-error";
import { primaryDomain } from "@/lib/service-url";
import { useTRPC } from "@/lib/trpc";

import { AddServiceMenu } from "./add-service-menu";
import { CreateEnvironmentDialog } from "./create-environment-dialog";
import { DeploymentsTab } from "./deployments-tab";
import { EnvironmentActions } from "./environment-actions";
import { EnvironmentVariablesTab } from "./environment-variables-tab";
import { ManageTagsDialog } from "./manage-tags-dialog";
import { ProjectActions } from "./project-actions";
import { DATABASE_TYPES, type DatabaseType, SERVICE_TYPE_META } from "./service-types";
import { type ServiceEntry, ServicesTable } from "./services-table";
import { UpstreamsTable } from "./upstreams-table";

type NewServiceDialog = "application" | "compose" | DatabaseType;

/** Validate the ?new= deep link from the command palette. */
function parseNewParam(value: string | null): NewServiceDialog | null {
	if (value === "application" || value === "compose") {
		return value;
	}
	if (value && (DATABASE_TYPES as readonly string[]).includes(value)) {
		return value as DatabaseType;
	}
	return null;
}

type ProjectTab = "services" | "environment" | "deployments" | "recovery-copies";

const PROJECT_TABS: { value: ProjectTab; label: string }[] = [
	{ value: "services", label: "Services" },
	{ value: "environment", label: "Environment variables" },
	{ value: "deployments", label: "Deployments" },
	{ value: "recovery-copies", label: "Recovery copies" },
];

function isProjectTab(value: string | undefined): value is ProjectTab {
	return PROJECT_TABS.some((tab) => tab.value === value);
}

export function ProjectDetail({
	projectId,
	initialEnvironment,
	initialTab,
}: {
	projectId: string;
	initialEnvironment?: string;
	initialTab?: string;
}) {
	const trpc = useTRPC();
	const router = useRouter();
	const searchParams = useSearchParams();
	const { can, isLoading: capabilitiesLoading } = useCapabilities();
	const mayOpenServiceDialog = !capabilitiesLoading && can("service.create");
	const [search, setSearch] = useState("");
	const [tagFilter, setTagFilter] = useState<string | null>(null);
	const [environmentName, setEnvironmentName] = useState(initialEnvironment || "production");
	const [tab, setTab] = useState<ProjectTab>(isProjectTab(initialTab) ? initialTab : "services");
	// Deep link (?new=application|compose|<db>) from the command palette. Held
	// here (not seeded once into AddServiceMenu) so a same-route push from the
	// palette re-triggers it, and handed to exactly one menu instance.
	const [pendingDialog, setPendingDialog] = useState<NewServiceDialog | null>(null);

	useEffect(() => {
		const requested = parseNewParam(searchParams.get("new"));
		setEnvironmentName(searchParams.get("env") || "production");
		const requestedTab = searchParams.get("tab") ?? undefined;
		setTab(requested ? "services" : isProjectTab(requestedTab) ? requestedTab : "services");
		if (!requested || !mayOpenServiceDialog) {
			return;
		}
		setPendingDialog(requested);
		setTab("services");
		// Strip the param so a refresh doesn't reopen the dialog.
		const params = new URLSearchParams(searchParams.toString());
		params.delete("new");
		params.delete("tab");
		const query = params.toString();
		router.replace(`/dashboard/projects/${projectId}${query ? `?${query}` : ""}`, {
			scroll: false,
		});
	}, [mayOpenServiceDialog, projectId, router, searchParams]);

	const projectQuery = useQuery(trpc.project.one.queryOptions({ projectId }));
	const environmentsQuery = useQuery({
		...trpc.environment.byProject.queryOptions({ projectId }),
		enabled: tab !== "recovery-copies",
	});

	const environments = environmentsQuery.data;
	const activeEnvironment =
		environments?.find((environment) => environment.name === environmentName) ?? environments?.[0];
	const activeEnvironmentName = activeEnvironment?.name ?? environmentName;

	const serviceInput = useMemo(
		() => ({ projectId, environmentName: activeEnvironmentName }),
		[projectId, activeEnvironmentName],
	);

	const applicationsQuery = useQuery({
		...trpc.application.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const composeQuery = useQuery({
		...trpc.compose.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const postgresQuery = useQuery({
		...trpc.postgres.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const mysqlQuery = useQuery({
		...trpc.mysql.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const mariadbQuery = useQuery({
		...trpc.mariadb.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const mongoQuery = useQuery({
		...trpc.mongo.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const redisQuery = useQuery({
		...trpc.redis.all.queryOptions(serviceInput),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});

	const tagsCatalogQuery = useQuery({
		...trpc.tag.all.queryOptions(),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});

	// One project-wide domain query feeds the address column; per-row queries
	// would be one request per service.
	const domainsQuery = useQuery({
		...trpc.domain.all.queryOptions({ projectId }),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	// External upstreams are routing rows, not services: listed under the
	// services table rather than mixed into it.
	const upstreamsQuery = useQuery({
		...trpc.upstream.all.queryOptions({ environmentId: activeEnvironment?.environmentId ?? "" }),
		enabled: tab === "services" && Boolean(activeEnvironment),
	});
	const primaryDomains = useMemo(() => {
		const rows = domainsQuery.data ?? [];
		const byService = new Map<string, typeof rows>();
		for (const row of rows) {
			const key = row.applicationId
				? `application:${row.applicationId}`
				: row.composeId
					? `compose:${row.composeId}`
					: row.externalUpstreamId
						? `upstream:${row.externalUpstreamId}`
						: null;
			if (!key) continue;
			const bucket = byService.get(key);
			if (bucket) bucket.push(row);
			else byService.set(key, [row]);
		}
		const result = new Map<string, (typeof rows)[number]>();
		for (const [key, bucket] of byService) {
			const picked = primaryDomain(bucket);
			if (picked) result.set(key, picked);
		}
		return result;
	}, [domainsQuery.data]);

	const serviceRefs = useMemo(
		() => [
			...(applicationsQuery.data ?? []).map((row) => ({
				type: "application" as const,
				id: row.applicationId,
			})),
			...(composeQuery.data ?? []).map((row) => ({ type: "compose" as const, id: row.composeId })),
			...(postgresQuery.data ?? []).map((row) => ({
				type: "postgres" as const,
				id: row.postgresId,
			})),
			...(mysqlQuery.data ?? []).map((row) => ({ type: "mysql" as const, id: row.mysqlId })),
			...(mariadbQuery.data ?? []).map((row) => ({ type: "mariadb" as const, id: row.mariadbId })),
			...(mongoQuery.data ?? []).map((row) => ({ type: "mongo" as const, id: row.mongoId })),
			...(redisQuery.data ?? []).map((row) => ({ type: "redis" as const, id: row.redisId })),
		],
		[
			applicationsQuery.data,
			composeQuery.data,
			postgresQuery.data,
			mysqlQuery.data,
			mariadbQuery.data,
			mongoQuery.data,
			redisQuery.data,
		],
	);

	const serviceTagsQuery = useQuery({
		...trpc.tag.forServices.queryOptions({ services: serviceRefs }),
		enabled: tab === "services" && serviceRefs.length > 0,
	});

	const tagsByService = serviceTagsQuery.data ?? {};

	const services: ServiceEntry[] = [
		...(applicationsQuery.data ?? []).map((row) => ({
			type: "application" as const,
			id: row.applicationId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`application:${row.applicationId}`],
			domain: primaryDomains.get(`application:${row.applicationId}`),
		})),
		...(composeQuery.data ?? []).map((row) => ({
			type: "compose" as const,
			id: row.composeId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`compose:${row.composeId}`],
			domain: primaryDomains.get(`compose:${row.composeId}`),
		})),
		...(postgresQuery.data ?? []).map((row) => ({
			type: "postgres" as const,
			id: row.postgresId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`postgres:${row.postgresId}`],
		})),
		...(mysqlQuery.data ?? []).map((row) => ({
			type: "mysql" as const,
			id: row.mysqlId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`mysql:${row.mysqlId}`],
		})),
		...(mariadbQuery.data ?? []).map((row) => ({
			type: "mariadb" as const,
			id: row.mariadbId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`mariadb:${row.mariadbId}`],
		})),
		...(mongoQuery.data ?? []).map((row) => ({
			type: "mongo" as const,
			id: row.mongoId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`mongo:${row.mongoId}`],
		})),
		...(redisQuery.data ?? []).map((row) => ({
			type: "redis" as const,
			id: row.redisId,
			name: row.name,
			description: row.description,
			status: row.status,
			tags: tagsByService[`redis:${row.redisId}`],
		})),
	];

	const serviceQueries = [
		{ label: "Applications", query: applicationsQuery },
		{ label: "Compose stacks", query: composeQuery },
		{ label: "PostgreSQL", query: postgresQuery },
		{ label: "MySQL", query: mysqlQuery },
		{ label: "MariaDB", query: mariadbQuery },
		{ label: "MongoDB", query: mongoQuery },
		{ label: "Redis", query: redisQuery },
	];
	const failedServiceQueries = serviceQueries.filter(({ query }) => query.isError);
	const isLoadingServices =
		environmentsQuery.isPending ||
		(Boolean(activeEnvironment) &&
			(serviceQueries.some(({ query }) => query.isPending) ||
				upstreamsQuery.isPending ||
				(serviceRefs.length > 0 && serviceTagsQuery.isPending)));
	const hasFilters = Boolean(search.trim() || tagFilter);
	const resetFilters = () => {
		setSearch("");
		setTagFilter(null);
	};

	const filteredServices = services.filter((service) => {
		// Name, description and kind: typing "postgres" should find the database
		// even when it is called `leet-db`, and typing a word from the
		// description should find the service it describes.
		const needle = search.trim().toLowerCase();
		const matchesSearch =
			!needle ||
			[
				service.name,
				service.description,
				service.type,
				SERVICE_TYPE_META[service.type].label,
				service.domain?.host,
				...(service.tags ?? []).map((tag) => tag.name),
			].some((field) => field?.toLowerCase().includes(needle));
		const matchesTag = !tagFilter || service.tags?.some((tag) => tag.tagId === tagFilter);
		return matchesSearch && matchesTag;
	});

	const hasMatchingUpstreams =
		!tagFilter &&
		(upstreamsQuery.data ?? []).some((row) =>
			[row.name, row.description, row.targetUrl].some((field) =>
				field?.toLowerCase().includes(search.trim().toLowerCase()),
			),
		);

	const syncUrl = (env: string, nextTab: ProjectTab) => {
		const params = new URLSearchParams({ env });
		if (nextTab !== "services") {
			params.set("tab", nextTab);
		}
		router.replace(`/dashboard/projects/${projectId}?${params.toString()}`, {
			scroll: false,
		});
	};

	const selectEnvironment = (name: string) => {
		resetFilters();
		setEnvironmentName(name);
		syncUrl(name, tab);
	};

	// User-driven switches unmount the tab's forms (the env editor is keyed by
	// environment), so they go through the unsaved-changes guard; the
	// programmatic calls after rename/duplicate/create do not.
	const switchEnvironment = (name: string) => {
		if (name === activeEnvironmentName || !confirmDiscardUnsavedChanges()) return;
		selectEnvironment(name);
	};

	const selectTab = (value: string) => {
		const nextTab = value as ProjectTab;
		if (nextTab === tab || !confirmDiscardUnsavedChanges()) return;
		setTab(nextTab);
		syncUrl(activeEnvironmentName, nextTab);
	};

	const project = projectQuery.data;
	const canWriteProject = can("project.write");
	const canCreateService = can("service.create");

	if (projectQuery.isError || (!projectQuery.isPending && !project)) {
		return (
			<div className="space-y-4">
				<LoadError
					title={
						projectQuery.error?.data?.code === "NOT_FOUND"
							? "Project not found"
							: "Could not load project"
					}
					message={
						projectQuery.error
							? describeError(projectQuery.error)
							: "This project does not exist or you don't have access."
					}
					onRetry={() => void projectQuery.refetch()}
				/>
				<Button variant="outline" asChild>
					<Link href="/dashboard">Back to projects</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-4 sm:gap-6">
			<PageHeader
				compactActions
				breadcrumb={
					<Link
						href="/dashboard"
						className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Projects
					</Link>
				}
				title={
					projectQuery.isPending ? <Skeleton className="h-7 w-40" /> : (project?.name ?? "Project")
				}
				description={project?.description || undefined}
				actions={project ? <ProjectActions project={project} /> : undefined}
			/>

			<Tabs value={tab} onValueChange={selectTab}>
				<UnderlineTabsList aria-label="Project sections">
					{PROJECT_TABS.map((item) => (
						<UnderlineTabsTrigger key={item.value} value={item.value}>
							{item.label}
							{/* Only Services can be counted without a second query; the
							    others would cost a round trip to say nothing useful. */}
							{item.value === "services" && !isLoadingServices ? (
								<span className="ms-1.5 tabular-nums text-muted-foreground">{services.length}</span>
							) : null}
						</UnderlineTabsTrigger>
					))}
				</UnderlineTabsList>
				<TabsContent value="recovery-copies" className="mt-4">
					{projectQuery.isPending ? (
						<Skeleton className="h-48 w-full" />
					) : project ? (
						<RecoveryCopies key={projectId} scope={{ projectId }} />
					) : null}
				</TabsContent>
			</Tabs>

			{(tab === "services" || tab === "environment") && (
				<div className="surface overflow-hidden">
					<div className="flex flex-wrap items-center justify-between gap-3 bg-panel-inset px-4 py-3 sm:px-5 sm:py-4">
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
							<span className="hidden text-xs text-muted-foreground sm:block">Environment</span>
							{environmentsQuery.isPending ? (
								<Skeleton className="h-9 w-40" />
							) : activeEnvironment ? (
								<>
									<Select value={activeEnvironmentName} onValueChange={switchEnvironment}>
										<SelectTrigger aria-label="Select environment" className="max-w-56 min-w-32">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{(environments ?? []).map((environment) => (
												<SelectItem key={environment.environmentId} value={environment.name}>
													{environment.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<EnvironmentActions
										projectId={projectId}
										environment={activeEnvironment}
										isOnlyEnvironment={(environments ?? []).length <= 1}
										onRenamed={selectEnvironment}
										onDuplicated={selectEnvironment}
										onDeleted={() => {
											const remaining = (environments ?? []).find(
												(environment) =>
													environment.environmentId !== activeEnvironment.environmentId,
											);
											if (remaining) selectEnvironment(remaining.name);
										}}
									/>
								</>
							) : null}{" "}
							<DisabledHint hint={canWriteProject ? undefined : capabilityHint("project.write")}>
								<CreateEnvironmentDialog projectId={projectId} onCreated={selectEnvironment}>
									<Button
										variant="outline"
										size="icon"
										className="sm:w-auto sm:px-3"
										aria-label="New environment"
										title="New environment"
										disabled={!canWriteProject}
									>
										<Plus className="size-4" />
										<span className="hidden sm:inline">New environment</span>
									</Button>
								</CreateEnvironmentDialog>
							</DisabledHint>
						</div>
						{tab === "services" ? (
							<div className="flex flex-wrap items-center gap-2">
								{activeEnvironment ? (
									<AddServiceMenu
										projectId={projectId}
										environmentId={activeEnvironment.environmentId}
										environmentName={activeEnvironment.name}
										disabled={!canCreateService}
										disabledReason={capabilityHint("service.create")}
										openDialog={pendingDialog}
										onOpenDialogConsumed={() => setPendingDialog(null)}
									/>
								) : null}
							</div>
						) : null}
					</div>
					{tab === "services" ? (
						<div className="flex flex-wrap items-start justify-between gap-3 border-t px-4 py-3 sm:px-5 sm:py-4">
							<div className="relative min-w-40 flex-1 sm:max-w-80">
								<Search
									aria-hidden
									className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									placeholder="Search services and upstreams…"
									aria-label="Search services and upstreams"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									className="h-10 ps-9 pe-9"
								/>
								{search ? (
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Clear service search"
										className="absolute end-0.5 top-0.5"
										onClick={() => setSearch("")}
									>
										<X className="size-3.5" />
									</Button>
								) : null}
							</div>
							<div className="flex min-w-0 flex-wrap items-center gap-2">
								{(tagsCatalogQuery.data?.length ?? 0) > 0 ? (
									<Select
										value={tagFilter ?? "all"}
										onValueChange={(value) => setTagFilter(value === "all" ? null : value)}
									>
										<SelectTrigger aria-label="Filter services by tag" className="max-w-56">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All tags</SelectItem>
											{tagsCatalogQuery.data?.map((tag) => (
												<SelectItem key={tag.tagId} value={tag.tagId}>
													<span
														aria-hidden
														className="size-2 shrink-0 rounded-full"
														style={{ backgroundColor: tag.color }}
													/>
													{tag.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : null}
								{activeEnvironment ? <ManageTagsDialog /> : null}
							</div>
						</div>
					) : null}
				</div>
			)}

			{(tab === "services" || tab === "environment") && environmentsQuery.isError ? (
				<LoadError
					title="Could not load environments"
					message={describeError(environmentsQuery.error)}
					onRetry={() => void environmentsQuery.refetch()}
				/>
			) : null}

			{tab === "services" && failedServiceQueries.length > 0 ? (
				<div
					role="alert"
					className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between"
				>
					<div className="flex items-start gap-3">
						<AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
						<div className="space-y-1 text-sm">
							<p className="font-medium">Some services could not be loaded</p>
							<p className="text-muted-foreground">
								{failedServiceQueries.map(({ label }) => label).join(", ")}. The list may be
								incomplete.
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						onClick={() => {
							for (const { query } of failedServiceQueries) void query.refetch();
						}}
					>
						Retry
					</Button>
				</div>
			) : null}

			{tab === "services" &&
			(domainsQuery.isError || upstreamsQuery.isError || serviceTagsQuery.isError) ? (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm text-muted-foreground"
				>
					<p>
						{[
							domainsQuery.isError ? "Addresses" : null,
							upstreamsQuery.isError ? "External upstreams" : null,
							serviceTagsQuery.isError ? "Service tags" : null,
						]
							.filter(Boolean)
							.join(", ")}{" "}
						could not be loaded.
					</p>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							if (domainsQuery.isError) void domainsQuery.refetch();
							if (upstreamsQuery.isError) void upstreamsQuery.refetch();
							if (serviceTagsQuery.isError) void serviceTagsQuery.refetch();
						}}
					>
						Retry
					</Button>
				</div>
			) : null}

			{tab === "services" &&
				!environmentsQuery.isError &&
				(isLoadingServices ? (
					<div className="divide-y rounded-lg border">
						{Array.from({ length: 4 }).map((_, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
							<div key={index} className="flex items-center gap-4 px-4 py-3">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-4 w-40" />
							</div>
						))}
					</div>
				) : filteredServices.length > 0 ? (
					<>
						<ServicesTable
							key={activeEnvironment?.environmentId}
							projectId={projectId}
							environmentName={activeEnvironmentName}
							services={filteredServices}
							currentEnvironmentId={activeEnvironment?.environmentId}
						/>
						<UpstreamsTable
							projectId={projectId}
							upstreams={tagFilter ? [] : (upstreamsQuery.data ?? [])}
							primaryDomains={primaryDomains}
							search={search}
						/>
					</>
				) : hasMatchingUpstreams ? (
					<UpstreamsTable
						projectId={projectId}
						upstreams={tagFilter ? [] : (upstreamsQuery.data ?? [])}
						primaryDomains={primaryDomains}
						search={search}
					/>
				) : failedServiceQueries.length > 0 ||
					upstreamsQuery.isError ||
					(tagFilter && serviceTagsQuery.isError) ? null : (
					<EmptyState
						icon={hasFilters ? Search : FolderGit2}
						title={hasFilters ? "No services match" : "No services in this environment"}
						description={
							hasFilters
								? "Search by name, type, address, or tag. Clear the filters to see everything."
								: `Add an application, Compose stack, or database to ${activeEnvironmentName}.`
						}
						action={
							hasFilters ? (
								<Button variant="outline" onClick={resetFilters}>
									Clear filters
								</Button>
							) : activeEnvironment ? (
								<div className="flex flex-wrap items-center justify-center gap-2">
									<AddServiceMenu
										projectId={projectId}
										environmentId={activeEnvironment.environmentId}
										environmentName={activeEnvironment.name}
										disabled={!canCreateService}
										disabledReason={capabilityHint("service.create")}
									/>
									<Button asChild variant="outline">
										<Link href="/dashboard/templates">Browse templates</Link>
									</Button>
								</div>
							) : undefined
						}
					/>
				))}

			{tab === "environment" && !environmentsQuery.isError && (
				<EnvironmentVariablesTab
					projectId={projectId}
					projectEnv={project?.env}
					environment={activeEnvironment}
				/>
			)}

			{tab === "deployments" && <DeploymentsTab projectId={projectId} />}
		</div>
	);
}
