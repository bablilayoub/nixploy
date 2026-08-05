"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MonitoringTab({ compose }: { compose: ComposeService }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Monitoring</CardTitle>
				<CardDescription>
					Live CPU, memory and network usage of the compose containers.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<MonitoringCharts appName={compose.appName} serverId={compose.serverId} />
			</CardContent>
		</Card>
	);
}
