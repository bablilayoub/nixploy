"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

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

const ADVANCED_CATEGORIES = [
	{ value: "mounts", label: "Mounts", description: "Volumes, files and bind mounts" },
	{ value: "ports", label: "Ports", description: "Direct container connections" },
	{ value: "redirects", label: "Redirects", description: "URL forwarding rules" },
	{ value: "security", label: "Security", description: "Access and request protection" },
	{ value: "healthcheck", label: "Healthcheck", description: "Container readiness checks" },
	{ value: "placement", label: "Placement", description: "Where replicas can run" },
	{ value: "swarm", label: "Swarm", description: "Updates, scaling and runtime" },
	{ value: "rollbacks", label: "Rollbacks", description: "Restore a deployment snapshot" },
];

export function AdvancedTab() {
	const application = useApplication();
	const applicationId = application.applicationId;
	// Third level of the page's tabs: kept in its own `?advanced=` param so
	// `?tab=advanced&advanced=swarm` deep-links without touching `?tab=`.
	const [tab, selectTab] = useSyncedTab(
		"mounts",
		(value) => ADVANCED_CATEGORIES.some((category) => category.value === value),
		{
			param: "advanced",
		},
	);

	return (
		<Tabs
			value={tab}
			onValueChange={selectTab}
			orientation="vertical"
			className="fieldwork-category-workspace w-full"
		>
			<div className="grid gap-2 text-sm font-medium lg:hidden">
				Advanced section
				<Select value={tab} onValueChange={selectTab}>
					<SelectTrigger aria-label="Advanced section" className="w-full min-w-40">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{ADVANCED_CATEGORIES.map((category) => (
							<SelectItem key={category.value} value={category.value}>
								{category.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-xs font-normal text-muted-foreground">
					{ADVANCED_CATEGORIES.find((category) => category.value === tab)?.description}
				</span>
			</div>
			<TabsList aria-label="Advanced configuration categories" className="fieldwork-category-list">
				{ADVANCED_CATEGORIES.map((category) => (
					<TabsTrigger key={category.value} value={category.value}>
						<span className="min-w-0">
							<span className="block text-sm font-medium">{category.label}</span>
							<span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
								{category.description}
							</span>
						</span>
					</TabsTrigger>
				))}
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
