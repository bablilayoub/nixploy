"use client";

import { useQuery } from "@tanstack/react-query";
import { use } from "react";

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
import { ServiceTerminal } from "@/components/services/service-terminal";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useTRPC } from "@/lib/trpc";

export default function ApplicationDetailPage({
	params,
}: {
	params: Promise<{ projectId: string; id: string }>;
}) {
	const { projectId, id } = use(params);
	const trpc = useTRPC();
	const { data: application, isLoading } = useQuery(
		trpc.application.one.queryOptions({ applicationId: id }),
	);

	if (isLoading) {
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

	if (!application) {
		return (
			<Card>
				<CardContent className="py-10 text-center text-sm text-muted-foreground">
					Application not found.
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			<ApplicationHeader application={application} projectId={projectId} />

			<Tabs defaultValue="general" className="w-full">
				<UnderlineTabsList>
					<UnderlineTabsTrigger value="general">General</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="environment">Environment</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="domains">Domains</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="deployments">Deployments</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="logs">Logs</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="monitoring">Monitoring</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="terminal">Terminal</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="preview">Preview Deployments</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="schedules">Schedules</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="backups">Volume Backups</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="advanced">Advanced</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="settings">Settings</UnderlineTabsTrigger>
				</UnderlineTabsList>

				<TabsContent value="general" className="mt-6">
					<GeneralTab application={application} />
				</TabsContent>
				<TabsContent value="environment" className="mt-6">
					<EnvironmentTab application={application} />
				</TabsContent>
				<TabsContent value="domains" className="mt-6">
					<DomainManager serviceType="application" serviceId={application.applicationId} />
				</TabsContent>
				<TabsContent value="deployments" className="mt-6">
					<DeploymentsTab application={application} />
				</TabsContent>
				<TabsContent value="preview" className="mt-6">
					<PreviewDeploymentsTab application={application} />
				</TabsContent>
				<TabsContent value="schedules" className="mt-6">
					<SchedulesTab serviceType="application" serviceId={application.applicationId} />
				</TabsContent>
				<TabsContent value="backups" className="mt-6">
					<VolumeBackupsTab serviceType="application" serviceId={application.applicationId} />
				</TabsContent>
				<TabsContent value="logs" className="mt-6">
					<LogViewer appName={application.appName} serverId={application.serverId} />
				</TabsContent>
				<TabsContent value="monitoring" className="mt-6">
					<MonitoringCharts appName={application.appName} serverId={application.serverId} />
				</TabsContent>
				<TabsContent value="terminal" className="mt-6">
					<ServiceTerminal appName={application.appName} serverId={application.serverId} />
				</TabsContent>
				<TabsContent value="advanced" className="mt-6">
					<AdvancedTab application={application} />
				</TabsContent>
				<TabsContent value="settings" className="mt-6">
					<SettingsTab application={application} projectId={projectId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
