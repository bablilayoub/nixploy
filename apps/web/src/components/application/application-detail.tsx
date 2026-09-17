"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, Rocket } from "lucide-react";

import { AdvancedTab } from "@/components/application/advanced-tab";
import { ApplicationProvider } from "@/components/application/application-context";
import { ApplicationHeader } from "@/components/application/application-header";
import { DeploymentsTab } from "@/components/application/deployments-tab";
import { EnvironmentTab } from "@/components/application/environment-tab";
import { GeneralTab } from "@/components/application/general-tab";
import { PreviewDeploymentsTab } from "@/components/application/preview-deployments-tab";
import { SettingsTab } from "@/components/application/settings-tab";
import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { useApplicationActions } from "@/components/application/use-application-actions";
import { BackupsPanel } from "@/components/backups/backups-panel";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { SchedulesPanel } from "@/components/schedules/schedules-panel";
import { capabilityHint } from "@/components/services/capability-hint";
import { DomainManager } from "@/components/services/domain-manager";
import { LogViewer } from "@/components/services/log-viewer";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { SaveBarTabsContent } from "@/components/services/save-bar";
import { ServiceAlertRulesCard } from "@/components/services/service-alert-rules-card";
import { ServiceEvents } from "@/components/services/service-events";
import { ServiceLoadError } from "@/components/services/service-load-error";
import { ServiceTerminal } from "@/components/services/service-terminal";
import { SubTabsList, SubTabsTrigger } from "@/components/services/sub-tabs";
import { Button } from "@/components/ui/button";
import { DisabledHint } from "@/components/ui/disabled-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import { SERVICE_TAB_ALIASES, useSyncedTab } from "@/hooks/use-synced-tab";
import { useTRPC } from "@/lib/trpc";

/**
 * One tab order for every service kind (UX audit F8):
 * General · Deploy · Runtime · Domains · Environment · Backups · Advanced · Settings.
 */
const TOP_TABS = [
	"general",
	"deploy",
	"runtime",
	"domains",
	"environment",
	"backups",
	"advanced",
	"settings",
];

/** Sub-tab → its top-level tab, so ?tab=logs / ?tab=deployments deep-link. */
const SUB_TAB_PARENT: Record<string, string> = {
	deployments: "deploy",
	preview: "deploy",
	schedules: "deploy",
	logs: "runtime",
	monitoring: "runtime",
	events: "runtime",
	terminal: "runtime",
};

const SUB_TAB_DEFAULT: Record<string, string> = {
	deploy: "deployments",
	runtime: "logs",
};

export function PageSkeleton() {
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

export function ApplicationDetail({ projectId, id }: { projectId: string; id: string }) {
	const trpc = useTRPC();
	const [tab, selectTab] = useSyncedTab(
		"general",
		(value) => TOP_TABS.includes(value) || value in SUB_TAB_PARENT,
		{ aliases: SERVICE_TAB_ALIASES },
	);
	const topTab = TOP_TABS.includes(tab) ? tab : (SUB_TAB_PARENT[tab] ?? "general");
	const subTab = (parent: string) =>
		SUB_TAB_PARENT[tab] === parent ? tab : SUB_TAB_DEFAULT[parent];
	// No timer here: `useRunningDeployments` (mounted by ApplicationHeader)
	// polls only while something is queued/running and invalidates
	// `application.one` when a deployment settles, so the header and tabs
	// refresh on the edge instead of every 5 s forever (UX audit F13).
	const {
		data: application,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery(trpc.application.one.queryOptions({ applicationId: id }));
	// Shares the cache with the header, which already asks for the same list —
	// the count on the tab costs nothing and answers "is anything routed here?"
	// without opening the tab.
	const domainsQuery = useQuery({
		...trpc.domain.all.queryOptions({ applicationId: id }),
		enabled: Boolean(id),
	});
	const domainCount = domainsQuery.data?.length;

	const actions = useApplicationActions({ applicationId: id });
	const { can } = useCapabilities();
	// Start / Redeploy only make sense once a deployment succeeded (the swarm
	// service exists). `application.one` carries no such flag, so read the
	// recent deployments; `status` alone cannot tell (stop resets it to idle).
	const recentDeployments = useQuery({
		...trpc.deployment.byApplication.queryOptions({ applicationId: id, limit: 20 }),
		enabled: Boolean(application),
	});
	const hasDeployed =
		application?.status === "done" ||
		application?.status === "running" ||
		(recentDeployments.data?.deployments ?? []).some((deployment) => deployment.status === "done");

	if (isLoading) {
		return <PageSkeleton />;
	}

	if (isError || !application) {
		return (
			<ServiceLoadError
				label="Application"
				projectId={projectId}
				error={isError ? error : null}
				onRetry={() => refetch()}
			/>
		);
	}

	const canDeploy = can("service.deploy");
	const canRuntime = can("service.runtime");
	// One CTA for every runtime empty state: Start once deployed, Deploy before.
	const runtimeAction = hasDeployed ? (
		<DisabledHint hint={canRuntime ? undefined : capabilityHint("service.runtime")}>
			<Button
				size="sm"
				disabled={actions.isBusy || !canRuntime}
				onClick={() => actions.start.mutate({ applicationId: id })}
			>
				{actions.start.isPending ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Play className="size-4" />
				)}
				Start
			</Button>
		</DisabledHint>
	) : (
		<DisabledHint hint={canDeploy ? undefined : capabilityHint("service.deploy")}>
			<Button
				size="sm"
				disabled={actions.isBusy || !canDeploy}
				onClick={() => actions.deploy.mutate({ applicationId: id })}
			>
				{actions.deploy.isPending ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Rocket className="size-4" />
				)}
				Deploy
			</Button>
		</DisabledHint>
	);

	return (
		<ApplicationProvider application={application}>
			<div className="flex flex-col gap-6">
				<ApplicationHeader
					application={application}
					projectId={projectId}
					actions={actions}
					hasDeployed={hasDeployed}
				/>

				<Tabs value={topTab} onValueChange={selectTab} activationMode="manual" className="w-full">
					<UnderlineTabsList>
						<UnderlineTabsTrigger value="general">General</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="deploy">Deploy</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="runtime">Runtime</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="domains">
							Domains
							{domainCount ? (
								<span className="ms-1.5 tabular-nums text-muted-foreground">{domainCount}</span>
							) : null}
						</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="environment">Environment</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="backups">Backups</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="advanced">Advanced</UnderlineTabsTrigger>
						<UnderlineTabsTrigger value="settings">Settings</UnderlineTabsTrigger>
					</UnderlineTabsList>

					<SaveBarTabsContent value="general" className="mt-6">
						<GeneralTab />
					</SaveBarTabsContent>

					<SaveBarTabsContent value="deploy" className="mt-6">
						<Tabs
							value={subTab("deploy")}
							onValueChange={selectTab}
							activationMode="manual"
							className="w-full gap-4"
						>
							<SubTabsList>
								<SubTabsTrigger value="deployments">Deployments</SubTabsTrigger>
								<SubTabsTrigger value="preview">Preview</SubTabsTrigger>
								<SubTabsTrigger value="schedules">Schedules</SubTabsTrigger>
							</SubTabsList>
							<TabsContent value="deployments" className="mt-0">
								<DeploymentsTab application={application} />
							</TabsContent>
							<TabsContent value="preview" className="mt-0">
								<PreviewDeploymentsTab application={application} />
							</TabsContent>
							<TabsContent value="schedules" className="mt-0">
								<SchedulesPanel
									source={{
										kind: "service",
										serviceType: "application",
										serviceId: application.applicationId,
									}}
								/>
							</TabsContent>
						</Tabs>
					</SaveBarTabsContent>

					<SaveBarTabsContent value="runtime" className="mt-6">
						<Tabs
							value={subTab("runtime")}
							onValueChange={selectTab}
							activationMode="manual"
							className="w-full gap-4"
						>
							<SubTabsList>
								<SubTabsTrigger value="logs">Logs</SubTabsTrigger>
								<SubTabsTrigger value="monitoring">Monitoring</SubTabsTrigger>
								<SubTabsTrigger value="events">Events</SubTabsTrigger>
								<SubTabsTrigger value="terminal">Terminal</SubTabsTrigger>
							</SubTabsList>
							<TabsContent value="logs" className="mt-0">
								<SettingsSection bare title="Logs" description="Live container output.">
									<LogViewer
										appName={application.appName}
										serverId={application.serverId}
										serviceStatus={application.status}
										notRunningAction={runtimeAction}
									/>
								</SettingsSection>
							</TabsContent>
							<TabsContent value="monitoring" className="mt-0">
								<SettingsStack>
									<SettingsSection bare title="Monitoring" description="CPU, memory, and network.">
										<MonitoringCharts
											appName={application.appName}
											serverId={application.serverId}
											serviceType="application"
											serviceId={application.applicationId}
											serviceStatus={application.status}
											notRunningAction={runtimeAction}
										/>
									</SettingsSection>
									<ServiceAlertRulesCard applicationId={application.applicationId} />
								</SettingsStack>
							</TabsContent>
							<TabsContent value="events" className="mt-0">
								<SettingsSection
									bare
									title="Events"
									description="Deploys, restarts, failed tasks and config changes, newest first."
								>
									<ServiceEvents serviceType="application" serviceId={application.applicationId} />
								</SettingsSection>
							</TabsContent>
							<TabsContent value="terminal" className="mt-0">
								<SettingsSection bare title="Terminal" description="Shell into the container.">
									<ServiceTerminal
										appName={application.appName}
										serverId={application.serverId}
										serviceStatus={application.status}
										notRunningAction={runtimeAction}
									/>
								</SettingsSection>
							</TabsContent>
						</Tabs>
					</SaveBarTabsContent>

					<SaveBarTabsContent value="domains" className="mt-6">
						<DomainManager serviceType="application" serviceId={application.applicationId} />
					</SaveBarTabsContent>

					<SaveBarTabsContent value="environment" className="mt-6">
						<EnvironmentTab application={application} />
					</SaveBarTabsContent>

					<SaveBarTabsContent value="backups" className="mt-6">
						<BackupsPanel
							target={{
								kind: "volume",
								serviceType: "application",
								serviceId: application.applicationId,
							}}
						/>
					</SaveBarTabsContent>

					<SaveBarTabsContent value="advanced" className="mt-6">
						<AdvancedTab />
					</SaveBarTabsContent>

					<SaveBarTabsContent value="settings" className="mt-6">
						<SettingsTab application={application} projectId={projectId} />
					</SaveBarTabsContent>
				</Tabs>
			</div>
		</ApplicationProvider>
	);
}
