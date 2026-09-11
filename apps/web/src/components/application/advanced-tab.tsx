"use client";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useSyncedTab } from "@/hooks/use-synced-tab";

import { useApplication } from "./application-context";
import { HealthcheckManager } from "./healthcheck-manager";
import { MountsManager } from "./mounts-manager";
import { PlacementManager } from "./placement-manager";
import { PortsManager } from "./ports-manager";
import { RedirectsManager } from "./redirects-manager";
import { RollbacksManager } from "./rollbacks-manager";
import { SecurityManager } from "./security-manager";
import { SwarmConfig } from "./swarm-config";
import { UnderlineTabsList, UnderlineTabsTrigger } from "./underline-tabs";

const ADVANCED_TABS = [
	"mounts",
	"ports",
	"redirects",
	"security",
	"healthcheck",
	"placement",
	"swarm",
	"rollbacks",
];

export function AdvancedTab() {
	const application = useApplication();
	const applicationId = application.applicationId;
	// Third level of the page's tabs: kept in its own `?advanced=` param so
	// `?tab=advanced&advanced=swarm` deep-links without touching `?tab=`.
	const [tab, selectTab] = useSyncedTab("mounts", (value) => ADVANCED_TABS.includes(value), {
		param: "advanced",
	});

	return (
		<Tabs value={tab} onValueChange={selectTab} className="w-full">
			<UnderlineTabsList>
				<UnderlineTabsTrigger value="mounts">Mounts</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="ports">Ports</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="redirects">Redirects</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="security">Security</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="healthcheck">Healthcheck</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="placement">Placement</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="swarm">Swarm</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="rollbacks">Rollbacks</UnderlineTabsTrigger>
			</UnderlineTabsList>
			<TabsContent value="mounts" className="mt-6">
				<MountsManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="ports" className="mt-6">
				<PortsManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="redirects" className="mt-6">
				<RedirectsManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="security" className="mt-6">
				<SecurityManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="healthcheck" className="mt-6">
				<HealthcheckManager application={application} />
			</TabsContent>
			<TabsContent value="placement" className="mt-6">
				<PlacementManager application={application} />
			</TabsContent>
			<TabsContent value="swarm" className="mt-6">
				<SwarmConfig application={application} />
			</TabsContent>
			<TabsContent value="rollbacks" className="mt-6">
				<RollbacksManager applicationId={applicationId} />
			</TabsContent>
		</Tabs>
	);
}
