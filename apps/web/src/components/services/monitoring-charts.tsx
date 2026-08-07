"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

function ChartsFallback() {
	return <Skeleton className="h-80 w-full rounded-lg" />;
}

/** Lazy Recharts monitoring — defer until the Monitoring tab mounts. */
export const MonitoringCharts = dynamic(
	() => import("./monitoring-charts-impl").then((m) => m.MonitoringCharts),
	{
		ssr: false,
		loading: () => <ChartsFallback />,
	},
);
