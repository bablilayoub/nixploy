import type { Metadata } from "next";

import { MonitoringView } from "@/components/monitoring/monitoring-view";

export const metadata: Metadata = {
	title: "Monitoring",
};

export default function MonitoringPage() {
	return <MonitoringView />;
}
