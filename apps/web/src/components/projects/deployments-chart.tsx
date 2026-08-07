"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

/** Lazy Recharts deployments trend — keep the dashboard shell light. */
export const DeploymentsChart = dynamic(
	() => import("./deployments-chart-impl").then((m) => m.DeploymentsChart),
	{
		ssr: false,
		loading: () => <Skeleton className="h-[13.5rem] w-full rounded-xl" />,
	},
);
