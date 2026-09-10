"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense, use, useState } from "react";

import { AdvancedTab } from "@/components/application/advanced-tab";
import { ApplicationHeader } from "@/components/application/application-header";
import { DeploymentsTab } from "@/components/application/deployments-tab";
import { EnvironmentTab } from "@/components/application/environment-tab";
import { GeneralTab } from "@/components/application/general-tab";
import { PreviewDeploymentsTab } from "@/components/application/preview-deployments-tab";
import { SettingsTab } from "@/components/application/settings-tab";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { VolumeBackupsTab } from "@/components/backups/volume-backups-tab";
import { SchedulesTab } from "@/components/schedules/schedules-tab";
import { DomainManager } from "@/components/services/domain-manager";
import { LogViewer } from "@/components/services/log-viewer";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { ServiceAlertRulesCard } from "@/components/services/service-alert-rules-card";
import { ServiceTerminal } from "@/components/services/service-terminal";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { SettingsSection, SettingsStack } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useSyncedTab } from "@/hooks/use-synced-tab";
import { useTRPC } from "@/lib/trpc";

const TOP_TABS = ["general", "deploy", "runtime", "domains", "config", "settings"];

/** Sub-tab → its top-level tab, so ?tab=logs / ?tab=deployments deep-link. */
const SUB_TAB_PARENT: Record<string, string> = {
	deployments: "deploy",
	preview: "deploy",
	schedules: "deploy",
	backups: "deploy",
	logs: "runtime",
	monitoring: "runtime",
	terminal: "runtime",
	environment: "config",
	advanced: "config",
};

const SUB_TAB_DEFAULT: Record<string, string> = {
	deploy: "deployments",
	runtime: "logs",
	config: "environment",
};

function PageSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-7 w-48" />
					<Skeleton className="h-4 w-72" />
				</div>
				<Skeleton className="h-9 w-40" />
			</div>
			<Skeleton className="h-9 w-full max-w-2xl" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function ApplicationDetailPage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = use(params);
	// useSyncedTab reads useSearchParams — needs a Suspense boundary at page level.
	return (
		<Suspense fallback={<PageSkeleton />}>
			<ApplicationDetail projectId={projectId} id={id} />
		</Suspense>
	);
}

function ApplicationDetail({ projectId, id }: { projectId: string; id: string }) {
	const trpc = useTRPC();
	const [tab, selectTab] = useSyncedTab(
		"general",
		(value) => TOP_TABS.includes(value) || value in SUB_TAB_PARENT,
	);
	const topTab = TOP_TABS.includes(tab) ? tab : (SUB_TAB_PARENT[tab] ?? "general");
	const subTab = (parent: string) =>
		SUB_TAB_PARENT[tab] === parent ? tab : SUB_TAB_DEFAULT[parent];
	// The worker flips `status` to "running" only when it picks the job up, a
	// moment after the deploy mutation returns; poll for a bounded window after
	// queuing so that edge is not missed when the queue is busy.
	const [pollUntil, setPollUntil] = useState(0);
	const {
		data: application,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...trpc.application.one.queryOptions({ applicationId: id }),
		// `status` stays "running" while a deployment builds and settles to
		// done/error when the worker finishes — poll until it does so the header
		// and tabs do not show a stale state.
		refetchInterval: (query) =>
			query.state.data?.status === "running" || Date.now() < pollUntil ? 5_000 : false,
	});

	if (isLoading) {
		return <PageSkeleton />;
	}

	if (isError || !application) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
				<p>{error?.message ?? "Application not found."}</p>
				{isError && (
					<Button variant="outline" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<ApplicationHeader
				application={application}
				projectId={projectId}
				onDeployQueued={() => setPollUntil(Date.now() + 30_000)}
			/>

			<Tabs value={topTab} onValueChange={selectTab} className="w-full">
				<UnderlineTabsList>
					<UnderlineTabsTrigger value="general">General</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="deploy">Deploy</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="runtime">Runtime</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="domains">Domains</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="config">Config</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="settings">Settings</UnderlineTabsTrigger>
				</UnderlineTabsList>

				<TabsContent value="general" className="mt-6">
					<GeneralTab application={application} />
				</TabsContent>

				<TabsContent value="deploy" className="mt-6">
					<Tabs value={subTab("deploy")} onValueChange={selectTab} className="w-full gap-4">
						<SubTabsList>
							<SubTabsTrigger value="deployments">Deployments</SubTabsTrigger>
							<SubTabsTrigger value="preview">Preview</SubTabsTrigger>
							<SubTabsTrigger value="schedules">Schedules</SubTabsTrigger>
							<SubTabsTrigger value="backups">Backups</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="deployments" className="mt-0">
							<DeploymentsTab application={application} />
						</TabsContent>
						<TabsContent value="preview" className="mt-0">
							<PreviewDeploymentsTab application={application} />
						</TabsContent>
						<TabsContent value="schedules" className="mt-0">
							<SchedulesTab serviceType="application" serviceId={application.applicationId} />
						</TabsContent>
						<TabsContent value="backups" className="mt-0">
							<VolumeBackupsTab serviceType="application" serviceId={application.applicationId} />
						</TabsContent>
					</Tabs>
				</TabsContent>

				<TabsContent value="runtime" className="mt-6">
					<Tabs value={subTab("runtime")} onValueChange={selectTab} className="w-full gap-4">
						<SubTabsList>
							<SubTabsTrigger value="logs">Logs</SubTabsTrigger>
							<SubTabsTrigger value="monitoring">Monitoring</SubTabsTrigger>
							<SubTabsTrigger value="terminal">Terminal</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="logs" className="mt-0">
							<SettingsSection bare title="Logs" description="Live container output.">
								<LogViewer appName={application.appName} serverId={application.serverId} />
							</SettingsSection>
						</TabsContent>
						<TabsContent value="monitoring" className="mt-0">
							<SettingsStack>
								<SettingsSection bare title="Monitoring" description="CPU, memory, and network.">
									<MonitoringCharts appName={application.appName} serverId={application.serverId} />
								</SettingsSection>
								<ServiceAlertRulesCard applicationId={application.applicationId} />
							</SettingsStack>
						</TabsContent>
						<TabsContent value="terminal" className="mt-0">
							<SettingsSection bare title="Terminal" description="Shell into the container.">
								<ServiceTerminal appName={application.appName} serverId={application.serverId} />
							</SettingsSection>
						</TabsContent>
					</Tabs>
				</TabsContent>

				<TabsContent value="domains" className="mt-6">
					<DomainManager serviceType="application" serviceId={application.applicationId} />
				</TabsContent>

				<TabsContent value="config" className="mt-6">
					<Tabs value={subTab("config")} onValueChange={selectTab} className="w-full gap-4">
						<SubTabsList>
							<SubTabsTrigger value="environment">Environment</SubTabsTrigger>
							<SubTabsTrigger value="advanced">Advanced</SubTabsTrigger>
						</SubTabsList>
						<TabsContent value="environment" className="mt-0">
							<EnvironmentTab application={application} />
						</TabsContent>
						<TabsContent value="advanced" className="mt-0">
							<AdvancedTab application={application} />
						</TabsContent>
					</Tabs>
				</TabsContent>

				<TabsContent value="settings" className="mt-6">
					<SettingsTab application={application} projectId={projectId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
