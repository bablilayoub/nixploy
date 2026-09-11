"use client";

import { Suspense } from "react";

import { UnderlineTabsList, UnderlineTabsTrigger } from "@/components/application/underline-tabs";
import { MonitoringView } from "@/components/monitoring/monitoring-view";
import { ActivityView } from "@/components/settings/activity/activity-view";
import { IncidentsView } from "@/components/settings/incidents/incidents-view";
import { PageHeader } from "@/components/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useCapabilities } from "@/hooks/use-capabilities";
import { useSyncedTab } from "@/hooks/use-synced-tab";

const TABS = ["fleet", "incidents", "audit"];

/**
 * Monitoring is the observability home (UX audit F11): the fleet overview
 * plus Incidents and the Audit log, which used to hide under Settings. The
 * old settings routes redirect here.
 */
export function MonitoringPage() {
	return (
		<Suspense fallback={<Skeleton className="h-64 w-full" />}>
			<MonitoringTabs />
		</Suspense>
	);
}

function MonitoringTabs() {
	const { can } = useCapabilities();
	const canAudit = can("audit.read");
	const [tab, selectTab] = useSyncedTab("fleet", (value) => TABS.includes(value));
	// A member without audit.read landing on ?tab=audit sees the fleet instead
	// of an error branch the page cannot recover from.
	const active = tab === "audit" && !canAudit ? "fleet" : tab;

	return (
		<div className="flex flex-col gap-5">
			<PageHeader
				title="Monitoring"
				description="Live metrics, incidents and the audit trail for this organization."
			/>
			<Tabs value={active} onValueChange={selectTab} className="w-full">
				<UnderlineTabsList>
					<UnderlineTabsTrigger value="fleet">Fleet</UnderlineTabsTrigger>
					<UnderlineTabsTrigger value="incidents">Incidents</UnderlineTabsTrigger>
					{canAudit ? <UnderlineTabsTrigger value="audit">Audit log</UnderlineTabsTrigger> : null}
				</UnderlineTabsList>
				<TabsContent value="fleet" className="mt-6">
					<MonitoringView embedded />
				</TabsContent>
				<TabsContent value="incidents" className="mt-6">
					<IncidentsView embedded />
				</TabsContent>
				{canAudit ? (
					<TabsContent value="audit" className="mt-6">
						<ActivityView embedded />
					</TabsContent>
				) : null}
			</Tabs>
		</div>
	);
}
