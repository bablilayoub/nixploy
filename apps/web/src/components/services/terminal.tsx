"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

function TerminalFallback() {
	return <Skeleton className="h-[26rem] w-full rounded-lg" />;
}

/** Lazy xterm shell — defer until the Terminal tab mounts. */
export const ServiceTerminal = dynamic(
	() => import("./terminal-impl").then((m) => m.ServiceTerminal),
	{
		ssr: false,
		loading: () => <TerminalFallback />,
	},
);
