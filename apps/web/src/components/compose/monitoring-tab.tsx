"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { SettingsSection, SettingsStack } from "@/components/layout/settings-section";
import { MonitoringCharts } from "@/components/services/monitoring-charts";
import { ServiceAlertRulesCard } from "@/components/services/service-alert-rules-card";

export function MonitoringTab({ compose }: { compose: ComposeService }) {
	return (
		<SettingsStack>
			<SettingsSection title="Monitoring" description="CPU, memory, and network." bare>
				<MonitoringCharts appName={compose.appName} serverId={compose.serverId} />
			</SettingsSection>
			<ServiceAlertRulesCard composeId={compose.composeId} />
		</SettingsStack>
	);
}
