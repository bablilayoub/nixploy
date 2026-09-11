import type { Metadata } from "next";

import { SchedulesPanel } from "@/components/schedules/schedules-panel";

export const metadata: Metadata = {
	title: "Schedules",
};

export default function SchedulesPage() {
	return <SchedulesPanel source={{ kind: "global" }} />;
}
