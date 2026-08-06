"use client";

import { Tabs, TabsContent } from "@/components/ui/tabs";

import { HealthcheckManager } from "./healthcheck-manager";
import { MountsManager } from "./mounts-manager";
import { PlacementManager } from "./placement-manager";
import { PortsManager } from "./ports-manager";
import { RedirectsManager } from "./redirects-manager";
import { RollbacksManager } from "./rollbacks-manager";
import { SecurityManager } from "./security-manager";
import type { Application } from "./types";
import { UnderlineTabsList, UnderlineTabsTrigger } from "./underline-tabs";

export function AdvancedTab({ application }: { application: Application }) {
	const applicationId = application.applicationId;

	return (
		<Tabs defaultValue="mounts" className="w-full">
			<UnderlineTabsList>
				<UnderlineTabsTrigger value="mounts">Mounts</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="ports">Ports</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="redirects">Redirects</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="security">Security</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="healthcheck">Healthcheck</UnderlineTabsTrigger>
				<UnderlineTabsTrigger value="placement">Placement</UnderlineTabsTrigger>
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
			<TabsContent value="rollbacks" className="mt-6">
				<RollbacksManager applicationId={applicationId} />
			</TabsContent>
		</Tabs>
	);
}
