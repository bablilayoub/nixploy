"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
			<TabsList
				aria-label="Advanced configuration categories"
				className="h-auto flex-wrap justify-start overflow-visible"
			>
				<TabsTrigger value="mounts">Mounts</TabsTrigger>
				<TabsTrigger value="ports">Ports</TabsTrigger>
				<TabsTrigger value="redirects">Redirects</TabsTrigger>
				<TabsTrigger value="security">Security</TabsTrigger>
				<TabsTrigger value="healthcheck">Healthcheck</TabsTrigger>
				<TabsTrigger value="placement">Placement</TabsTrigger>
				<TabsTrigger value="swarm">Swarm</TabsTrigger>
				<TabsTrigger value="rollbacks">Rollbacks</TabsTrigger>
			</TabsList>
			<TabsContent value="mounts" className="mt-2">
				<MountsManager target={{ kind: "application", applicationId }} />
			</TabsContent>
			<TabsContent value="ports" className="mt-2">
				<PortsManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="redirects" className="mt-2">
				<RedirectsManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="security" className="mt-2">
				<SecurityManager applicationId={applicationId} />
			</TabsContent>
			<TabsContent value="healthcheck" className="mt-2">
				<HealthcheckManager application={application} />
			</TabsContent>
			<TabsContent value="placement" className="mt-2">
				<PlacementManager application={application} />
			</TabsContent>
			<TabsContent value="swarm" className="mt-2">
				<SwarmConfig application={application} />
			</TabsContent>
			<TabsContent value="rollbacks" className="mt-2">
				<RollbacksManager applicationId={applicationId} />
			</TabsContent>
		</Tabs>
	);
}
