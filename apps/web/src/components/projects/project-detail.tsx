"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FolderGit2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { capabilityHint } from "@/components/services/capability-hint";
import { PageHeader } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import { confirmDiscardUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { primaryDomain } from "@/lib/service-url";
import { useTRPC } from "@/lib/trpc";

import { AddServiceMenu } from "./add-service-menu";
import { CreateEnvironmentDialog } from "./create-environment-dialog";
import { DeploymentsTab } from "./deployments-tab";
import { EnvironmentActions } from "./environment-actions";
import { EnvironmentVariablesTab } from "./environment-variables-tab";
import { ManageTagsDialog } from "./manage-tags-dialog";
import { ProjectActions } from "./project-actions";
import { DATABASE_TYPES, type DatabaseType } from "./service-types";
import { type ServiceEntry, ServicesTable } from "./services-table";

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

type ProjectTab = "services" | "environment" | "deployments";

const PROJECT_TABS: { value: ProjectTab; label: string }[] = [
	{ value: "services", label: "Services" },
	{ value: "environment", label: "Environment variables" },
	{ value: "deployments", label: "Deployments" },
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
	const { can } = useCapabilities();
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
		if (!requested) {
			return;
		}
		setPendingDialog(requested);
		setTab("services");
		// Strip the param so a refresh doesn't reopen the dialog.
		const params = new URLSearchParams(searchParams.toString());
		params.delete("new");
		const query = params.toString();
		router.replace(`/dashboard/projects/${projectId}${query ? `?${query}` : ""}`, {
			scroll: false,
		});
	}, [projectId, router, searchParams]);

	const projectQuery = useQuery(trpc.project.one.queryOptions({ projectId }));
	const environmentsQuery = useQuery(trpc.environment.byProject.queryOptions({ projectId }));

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
		enabled: tab === "services",
	});
	const composeQuery = useQuery({
		...trpc.compose.all.queryOptions(serviceInput),
		enabled: tab === "services",
	});
	const postgresQuery = useQuery({
		...trpc.postgres.all.queryOptions(serviceInput),
		enabled: tab === "services",
	});
	const mysqlQuery = useQuery({
		...trpc.mysql.all.queryOptions(serviceInput),
		enabled: tab === "services",
	});
	const mariadbQuery = useQuery({
		...trpc.mariadb.all.queryOptions(serviceInput),
		enabled: tab === "services",
	});
	const mongoQuery = useQuery({
		...trpc.mongo.all.queryOptions(serviceInput),
		enabled: tab === "services",
	});
	const redisQuery = useQuery({
		...trpc.redis.all.queryOptions(serviceInput),
		enabled: tab === "services",
	});

	const tagsCatalogQuery = useQuery({
		...trpc.tag.all.queryOptions(),
		enabled: tab === "services",
	});

	// One project-wide domain query feeds the address column; per-row queries
	// would be one request per service.
	const domainsQuery = useQuery({
		...trpc.domain.all.queryOptions({ projectId }),
		enabled: tab === "services",
	});
	const primaryDomains = useMemo(() => {
		const rows = domainsQuery.data ?? [];
		const byService = new Map<string, typeof rows>();
		for (const row of rows) {
			const key = row.applicationId
				? `application:${row.applicationId}`
				: row.composeId
					? `compose:${row.composeId}`
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

	const isLoadingServices =
		applicationsQuery.isPending ||
		composeQuery.isPending ||
		postgresQuery.isPending ||
		mysqlQuery.isPending ||
		mariadbQuery.isPending ||
		mongoQuery.isPending ||
		redisQuery.isPending;

	const filteredServices = services.filter((service) => {
		// Name, description and kind: typing "postgres" should find the database
		// even when it is called `leet-db`, and typing a word from the
		// description should find the service it describes.
		const needle = search.trim().toLowerCase();
		const matchesSearch =
			!needle ||
			[service.name, service.description, service.type].some((field) =>
				field?.toLowerCase().includes(needle),
			);
		const matchesTag = !tagFilter || service.tags?.some((tag) => tag.tagId === tagFilter);
		return matchesSearch && matchesTag;
	});

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
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
				<AlertTriangle className="size-8 text-muted-foreground" />
				<h2 className="text-lg font-semibold">Project not found</h2>
				<p className="text-sm text-muted-foreground">
					{projectQuery.error?.message ?? "This project does not exist or you don't have access."}
				</p>
				<Button variant="outline" onClick={() => router.push("/dashboard")}>
					Back to projects
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				breadcrumb={
					<Link href="/dashboard" className="transition-colors hover:text-foreground">
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
			</Tabs>

			{tab !== "deployments" && (
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					{environmentsQuery.isPending ? (
						<Skeleton className="h-9 w-64" />
					) : (
						<div className="flex min-w-0 items-center gap-1">
							<Tabs
								value={activeEnvironmentName}
								onValueChange={switchEnvironment}
								className="min-w-0"
							>
								<UnderlineTabsList aria-label="Environments" className="w-auto border-0">
									{(environments ?? []).map((environment) => (
										<UnderlineTabsTrigger key={environment.environmentId} value={environment.name}>
											{environment.name}
										</UnderlineTabsTrigger>
									))}
								</UnderlineTabsList>
							</Tabs>
							{activeEnvironment && (
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
										if (remaining) {
											selectEnvironment(remaining.name);
										}
									}}
								/>
							)}
						</div>
					)}
					{tab === "services" && (
						// Wraps on phones — the row used to push "Add service" off the
						// right edge, where nothing hinted it was there.
						<div className="flex flex-wrap items-center gap-2">
							<DisabledHint hint={canWriteProject ? undefined : capabilityHint("project.write")}>
								<CreateEnvironmentDialog projectId={projectId} onCreated={selectEnvironment}>
									<Button variant="outline" size="sm" disabled={!canWriteProject}>
										<Plus className="size-4" />
										Environment
									</Button>
								</CreateEnvironmentDialog>
							</DisabledHint>
							<div className="relative">
								<Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Search services..."
									aria-label="Search services"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									className="h-8 w-full pl-8 sm:w-56"
								/>
							</div>
							{(tagsCatalogQuery.data?.length ?? 0) > 0 && (
								<div className="flex flex-wrap items-center gap-1">
									<Button
										type="button"
										size="sm"
										variant={tagFilter === null ? "secondary" : "ghost"}
										className="h-8"
										onClick={() => setTagFilter(null)}
									>
										All tags
									</Button>
									{tagsCatalogQuery.data?.map((tag) => (
										<Button
											key={tag.tagId}
											type="button"
											size="sm"
											variant={tagFilter === tag.tagId ? "secondary" : "ghost"}
											className="h-8"
											onClick={() =>
												setTagFilter((current) => (current === tag.tagId ? null : tag.tagId))
											}
										>
											<span
												className="mr-1.5 size-2 rounded-full"
												style={{ backgroundColor: tag.color }}
											/>
											{tag.name}
										</Button>
									))}
								</div>
							)}
							{activeEnvironment && (
								<>
									<ManageTagsDialog />
									<AddServiceMenu
										projectId={projectId}
										environmentId={activeEnvironment.environmentId}
										environmentName={activeEnvironment.name}
										disabled={!canCreateService}
										disabledReason={capabilityHint("service.create")}
										openDialog={pendingDialog}
										onOpenDialogConsumed={() => setPendingDialog(null)}
									/>
								</>
							)}
						</div>
					)}
				</div>
			)}

			{tab === "services" &&
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
					<ServicesTable
						projectId={projectId}
						environmentName={activeEnvironmentName}
						services={filteredServices}
						currentEnvironmentId={activeEnvironment?.environmentId}
					/>
				) : (
					<div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
						<div className="flex size-12 items-center justify-center rounded-full bg-secondary">
							<FolderGit2 className="size-6 text-muted-foreground" />
						</div>
						<div className="flex flex-col gap-1">
							<p className="font-medium">
								{search ? "No services match your search" : "No services in this environment"}
							</p>
							<p className="text-sm text-muted-foreground">
								{search
									? "Try a different search term."
									: `Add an application, compose stack or database to "${activeEnvironmentName}".`}
							</p>
						</div>
						{/* The toolbar instance owns the ?new= deep link — never seed both. */}
						{!search && activeEnvironment && (
							<div className="flex flex-wrap items-center justify-center gap-2">
								<AddServiceMenu
									projectId={projectId}
									environmentId={activeEnvironment.environmentId}
									environmentName={activeEnvironment.name}
									disabled={!canCreateService}
									disabledReason={capabilityHint("service.create")}
								/>
								{/* The shortest path to a first running service, and the one
								    a new operator is least likely to find on their own. */}
								<Button asChild variant="outline">
									<Link href="/dashboard/templates">Browse templates</Link>
								</Button>
							</div>
						)}
					</div>
				))}

			{tab === "environment" && (
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
