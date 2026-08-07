import type { Metadata } from "next";

import { SchedulesView } from "@/components/schedules/schedules-view";

export const metadata: Metadata = {
	title: "Schedules",
};

export default function SchedulesPage() {
	return <SchedulesView />;
}
